using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using HappyHealthyHethersett.Api.Data;
using HappyHealthyHethersett.Api.Domain;
using HappyHealthyHethersett.Api.Models;
using HappyHealthyHethersett.Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;

namespace HappyHealthyHethersett.Api;

public static class ApiRoutes
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private const string LitterReportPhotoOwner = "LitterReport";
    private const string LitterPickEventPhotoOwner = "LitterPickEvent";

    public static void MapApiRoutes(this WebApplication app)
    {
        app.MapPost("/api/auth/login", async (
            LoginRequest request,
            AuthService authService,
            BearerTokenService bearerTokenService,
            HttpContext httpContext) =>
        {
            var user = await authService.AuthenticateAsync(request.Email, request.Password);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            await authService.SignInAsync(httpContext, user, request.RememberMe);
            return Results.Ok(bearerTokenService.CreateLoginResponse(user, request.RememberMe));
        }).AllowAnonymous();

        app.MapPost("/api/auth/register", async (RegisterRequest request, AuthService authService) =>
        {
            try
            {
                await authService.RegisterPendingUserAsync(request);
                return Results.Accepted(value: new
                {
                    ok = true,
                    message = "Registration received. An admin must enable the account before sign in."
                });
            }
            catch (InvalidOperationException error)
            {
                return Results.BadRequest(new { error = error.Message });
            }
        }).AllowAnonymous();

        app.MapPost("/api/auth/logout", async (HttpContext httpContext) =>
        {
            await httpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.Ok(new { ok = true });
        }).RequireAuthorization();

        app.MapGet("/api/auth/me", async (ClaimsPrincipal currentUser, AppDbContext db) =>
        {
            var user = await LoadCurrentUserAsync(currentUser, db);
            return user is null ? Results.Unauthorized() : Results.Ok(AuthService.ToCurrentUser(user));
        }).RequireAuthorization();

        app.MapPut("/api/account/profile", async (
            UpdateAccountRequest request,
            AuthService authService,
            ClaimsPrincipal currentUser) =>
        {
            var currentId = CurrentUserId(currentUser);
            if (currentId is null)
            {
                return Results.Unauthorized();
            }

            try
            {
                var user = await authService.UpdateAccountAsync(currentId.Value, request);
                return user is null ? Results.Unauthorized() : Results.Ok(AuthService.ToCurrentUser(user));
            }
            catch (InvalidOperationException error)
            {
                return Results.BadRequest(new { error = error.Message });
            }
        }).RequireAuthorization();

        app.MapPost("/api/account/password", async (
            ChangePasswordRequest request,
            AuthService authService,
            ClaimsPrincipal currentUser) =>
        {
            var currentId = CurrentUserId(currentUser);
            if (currentId is null)
            {
                return Results.Unauthorized();
            }

            try
            {
                var updated = await authService.ChangePasswordAsync(currentId.Value, request);
                return updated ? Results.Ok(new { ok = true }) : Results.Unauthorized();
            }
            catch (InvalidOperationException error)
            {
                return Results.BadRequest(new { error = error.Message });
            }
        }).RequireAuthorization();

        app.MapGet("/api/users", async (AppDbContext db) =>
        {
            var users = await db.Users
                .Include(user => user.UserRoles)
                .ThenInclude(userRole => userRole.Role)
                .OrderBy(user => user.Email)
                .ToListAsync();
            return Results.Ok(users.Select(AuthService.ToUserDto));
        }).RequireAuthorization(AppRoles.AdminOnlyPolicy);

        app.MapPost("/api/users", async (CreateUserRequest request, AuthService authService) =>
        {
            try
            {
                var user = await authService.CreateUserAsync(request);
                return Results.Created($"/api/users/{user.Id}", AuthService.ToUserDto(user));
            }
            catch (InvalidOperationException error)
            {
                return Results.BadRequest(new { error = error.Message });
            }
        }).RequireAuthorization(AppRoles.AdminOnlyPolicy);

        app.MapPut("/api/users/{id:guid}", async (Guid id, UpdateUserRequest request, AuthService authService, ClaimsPrincipal currentUser) =>
        {
            if (IsSelfLockout(id, request, currentUser))
            {
                return Results.BadRequest(new { error = "You cannot remove your own admin access." });
            }

            var user = await authService.UpdateUserAsync(id, request);
            return user is null ? Results.NotFound() : Results.Ok(AuthService.ToUserDto(user));
        }).RequireAuthorization(AppRoles.AdminOnlyPolicy);

        app.MapPost("/api/users/{id:guid}/password", async (Guid id, ResetPasswordRequest request, AuthService authService) =>
        {
            try
            {
                var updated = await authService.ResetPasswordAsync(id, request.Password);
                return updated ? Results.Ok(new { ok = true }) : Results.NotFound();
            }
            catch (InvalidOperationException error)
            {
                return Results.BadRequest(new { error = error.Message });
            }
        }).RequireAuthorization(AppRoles.AdminOnlyPolicy);

        app.MapGet("/api/events", async (AppDbContext db) =>
        {
            var events = await db.Events
                .AsNoTracking()
                .OrderBy(item => item.SortOrder)
                .Select(item => ToEventDto(item))
                .ToListAsync();
            return Results.Ok(events);
        }).AllowAnonymous();

        app.MapPut("/api/events", async (List<EventDto> events, AppDbContext db) =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync();
            db.Events.RemoveRange(await db.Events.ToListAsync());
            await db.Events.AddRangeAsync(events.Select((item, index) => ToEventEntity(item, index)));
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            return Results.Ok(events);
        }).RequireAuthorization(AppRoles.StaffOnlyPolicy);

        app.MapPost("/api/litter-reports", async (LitterReportDto payload, AppDbContext db) =>
        {
            var report = NormalizeReport(payload);
            if (report is null)
            {
                return Results.BadRequest(new { error = "Invalid litter report payload" });
            }

            await db.LitterReports.AddAsync(report);
            await db.StoredPhotos.AddRangeAsync(ToPhotoEntities(LitterReportPhotoOwner, report.Id, payload.Photos));
            var oldReports = await db.LitterReports
                .OrderByDescending(item => item.CreatedAt)
                .Skip(500)
                .ToListAsync();
            if (oldReports.Count > 0)
            {
                var oldReportIds = oldReports.Select(item => item.Id).ToArray();
                var oldPhotos = await db.StoredPhotos
                    .Where(photo => photo.OwnerType == LitterReportPhotoOwner && oldReportIds.Contains(photo.OwnerId))
                    .ToListAsync();
                db.StoredPhotos.RemoveRange(oldPhotos);
            }
            db.LitterReports.RemoveRange(oldReports);
            await db.SaveChangesAsync();
            var photos = await db.StoredPhotos
                .AsNoTracking()
                .Where(photo => photo.OwnerType == LitterReportPhotoOwner && photo.OwnerId == report.Id)
                .OrderBy(photo => photo.CreatedAt)
                .ToListAsync();
            return Results.Created($"/api/litter-reports/{report.Id}", ToLitterReportDto(report, photos));
        }).AllowAnonymous();

        app.MapGet("/api/litter-reports", async (AppDbContext db) =>
        {
            var reports = await db.LitterReports
                .AsNoTracking()
                .OrderByDescending(item => item.CreatedAt)
                .ToListAsync();
            var reportIds = reports.Select(item => item.Id).ToArray();
            var photos = await db.StoredPhotos
                .AsNoTracking()
                .Where(photo => photo.OwnerType == LitterReportPhotoOwner && reportIds.Contains(photo.OwnerId))
                .OrderBy(photo => photo.CreatedAt)
                .ToListAsync();
            var photosByReport = photos.GroupBy(photo => photo.OwnerId).ToDictionary(group => group.Key, group => group.ToList());
            return Results.Ok(reports.Select(report => ToLitterReportDto(report, photosByReport.GetValueOrDefault(report.Id) ?? new List<StoredPhotoEntity>())));
        }).RequireAuthorization(AppRoles.StaffOnlyPolicy);

        app.MapGet("/api/litter-pick-events", async (AppDbContext db) =>
        {
            var events = await db.LitterPickEvents
                .AsNoTracking()
                .OrderByDescending(item => item.Date)
                .ThenByDescending(item => item.Start)
                .ToListAsync();
            var eventIds = events.Select(item => item.Id).ToArray();
            var photos = await db.StoredPhotos
                .AsNoTracking()
                .Where(photo => photo.OwnerType == LitterPickEventPhotoOwner && eventIds.Contains(photo.OwnerId))
                .OrderBy(photo => photo.CreatedAt)
                .ToListAsync();
            var photosByEvent = photos.GroupBy(photo => photo.OwnerId).ToDictionary(group => group.Key, group => group.ToList());
            return Results.Ok(events.Select(item => ToLitterPickEventDto(item, photosByEvent.GetValueOrDefault(item.Id) ?? new List<StoredPhotoEntity>())));
        }).RequireAuthorization(AppRoles.StaffOnlyPolicy);

        app.MapPut("/api/litter-pick-events", async (List<LitterPickEventDto> events, AppDbContext db) =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync();
            db.LitterPickEvents.RemoveRange(await db.LitterPickEvents.ToListAsync());
            db.StoredPhotos.RemoveRange(await db.StoredPhotos.Where(photo => photo.OwnerType == LitterPickEventPhotoOwner).ToListAsync());
            var eventEntities = events.Select(ToLitterPickEventEntity).ToList();
            await db.LitterPickEvents.AddRangeAsync(eventEntities);
            await db.StoredPhotos.AddRangeAsync(events.SelectMany(item =>
            {
                var ownerId = string.IsNullOrWhiteSpace(item.Id) ? eventEntities.First(entity => entity.Title == item.Title && entity.Date == item.Date).Id : item.Id;
                return ToPhotoEntities(LitterPickEventPhotoOwner, ownerId, item.Photos);
            }));
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            return Results.Ok(events);
        }).RequireAuthorization(AppRoles.StaffOnlyPolicy);
    }

    private static bool IsSelfLockout(Guid id, UpdateUserRequest request, ClaimsPrincipal currentUser)
    {
        var currentIdText = currentUser.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(currentIdText, out var currentId)
            && currentId == id
            && (request.IsDisabled || request.Roles?.Contains(AppRoles.Admin) != true);
    }

    private static Guid? CurrentUserId(ClaimsPrincipal currentUser)
    {
        var currentIdText = currentUser.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(currentIdText, out var currentId) ? currentId : null;
    }

    private static async Task<AppUser?> LoadCurrentUserAsync(ClaimsPrincipal currentUser, AppDbContext db)
    {
        var currentId = CurrentUserId(currentUser);
        if (currentId is null)
        {
            return null;
        }

        return await db.Users
            .AsNoTracking()
            .Include(user => user.UserRoles)
            .ThenInclude(userRole => userRole.Role)
            .SingleOrDefaultAsync(user => user.Id == currentId && !user.IsDisabled);
    }

    private static EventDto ToEventDto(CommunityEvent item)
    {
        return new EventDto
        {
            Title = item.Title,
            Date = item.Date,
            Start = item.Start,
            End = item.End,
            Location = item.Location,
            Description = item.Description,
            CtaLabel = item.CtaLabel,
            CtaHref = item.CtaHref,
            Note = item.Note,
            Phone = item.Phone,
            ImageUrl = item.ImageUrl,
            ImageAlt = item.ImageAlt
        };
    }

    private static CommunityEvent ToEventEntity(EventDto item, int index)
    {
        return new CommunityEvent
        {
            SortOrder = index,
            Title = Clean(item.Title, 220),
            Date = Clean(item.Date, 40),
            Start = Clean(item.Start, 40),
            End = Clean(item.End, 40),
            Location = CleanOptional(item.Location, 220),
            Description = Clean(item.Description, 5000),
            CtaLabel = CleanOptional(item.CtaLabel, 120),
            CtaHref = CleanOptional(item.CtaHref, 1200),
            Note = CleanOptional(item.Note, 500),
            Phone = CleanOptional(item.Phone, 80),
            ImageUrl = CleanOptional(item.ImageUrl, 1_500_000),
            ImageAlt = CleanOptional(item.ImageAlt, 260)
        };
    }

    private static LitterReportDto ToLitterReportDto(LitterReportEntity report, List<StoredPhotoEntity> photos)
    {
        return new LitterReportDto
        {
            Id = report.Id,
            CreatedAt = report.CreatedAt,
            LocationLabel = report.LocationLabel,
            Lat = report.Lat,
            Lng = report.Lng,
            Amount = report.Amount,
            Comment = report.Comment,
            Contact = report.Contact,
            MapLink = report.MapLink,
            Photos = photos.Select(ToPhotoDto).ToList()
        };
    }

    private static LitterReportEntity? NormalizeReport(LitterReportDto payload)
    {
        if (!double.IsFinite(payload.Lat) || !double.IsFinite(payload.Lng))
        {
            return null;
        }

        if (payload.Lat < 52.55 || payload.Lat > 52.64 || payload.Lng < 1.1 || payload.Lng > 1.24)
        {
            return null;
        }

        var allowedAmounts = new HashSet<string>(StringComparer.Ordinal)
        {
            "Small amount",
            "Medium amount",
            "Large amount"
        };
        var amount = CleanOptional(payload.Amount, 40);

        return new LitterReportEntity
        {
            Id = $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Guid.NewGuid():N}"[..28],
            CreatedAt = DateTimeOffset.UtcNow,
            LocationLabel = CleanOptional(payload.LocationLabel, 80) ?? "Selected map point",
            Lat = payload.Lat,
            Lng = payload.Lng,
            Amount = amount is not null && allowedAmounts.Contains(amount) ? amount : null,
            Comment = CleanOptional(payload.Comment, 1200),
            Contact = CleanOptional(payload.Contact, 180),
            MapLink = MapLinkFor(payload.Lat, payload.Lng)
        };
    }

    private static LitterPickEventDto ToLitterPickEventDto(LitterPickEventEntity item, List<StoredPhotoEntity> photos)
    {
        return new LitterPickEventDto
        {
            Id = item.Id,
            Title = item.Title,
            Date = item.Date,
            Start = item.Start,
            End = item.End,
            MeetingPoint = item.MeetingPoint,
            MeetingPointLat = item.MeetingPointLat,
            MeetingPointLng = item.MeetingPointLng,
            Notes = item.Notes,
            Status = item.Status,
            Areas = DeserializeAreas(item.AreasJson),
            Photos = photos.Select(ToPhotoDto).ToList(),
            CreatedAt = item.CreatedAt,
            UpdatedAt = item.UpdatedAt
        };
    }

    private static LitterPickEventEntity ToLitterPickEventEntity(LitterPickEventDto item)
    {
        var now = DateTimeOffset.UtcNow;
        return new LitterPickEventEntity
        {
            Id = string.IsNullOrWhiteSpace(item.Id) ? $"litter-pick-{Guid.NewGuid():N}"[..24] : Clean(item.Id, 80),
            Title = Clean(item.Title, 220),
            Date = Clean(item.Date, 40),
            Start = CleanOptional(item.Start, 40),
            End = CleanOptional(item.End, 40),
            MeetingPoint = CleanOptional(item.MeetingPoint, 220),
            MeetingPointLat = item.MeetingPointLat,
            MeetingPointLng = item.MeetingPointLng,
            Notes = CleanOptional(item.Notes, 5000),
            Status = item.Status == "closed" ? "closed" : "open",
            AreasJson = JsonSerializer.Serialize(item.Areas ?? new List<LitterPickAreaDto>(), JsonOptions),
            CreatedAt = item.CreatedAt ?? now,
            UpdatedAt = now
        };
    }

    private static PhotoDto ToPhotoDto(StoredPhotoEntity photo)
    {
        return new PhotoDto
        {
            Id = photo.Id,
            FileName = photo.FileName,
            ContentType = photo.ContentType,
            DataUrl = $"data:{photo.ContentType};base64,{Convert.ToBase64String(photo.Data)}"
        };
    }

    private static IEnumerable<StoredPhotoEntity> ToPhotoEntities(string ownerType, string ownerId, IEnumerable<PhotoDto>? photos)
    {
        return (photos ?? Array.Empty<PhotoDto>())
            .Take(12)
            .Select(photo => ToPhotoEntity(ownerType, ownerId, photo))
            .Where(photo => photo is not null)
            .Cast<StoredPhotoEntity>();
    }

    private static StoredPhotoEntity? ToPhotoEntity(string ownerType, string ownerId, PhotoDto photo)
    {
        var contentType = Clean(photo.ContentType, 120).ToLowerInvariant();
        if (!contentType.StartsWith("image/", StringComparison.Ordinal))
        {
            return null;
        }

        var data = DecodeDataUrl(photo.DataUrl);
        if (data is null || data.Length == 0 || data.Length > 4_000_000)
        {
            return null;
        }

        return new StoredPhotoEntity
        {
            Id = string.IsNullOrWhiteSpace(photo.Id) ? $"photo-{Guid.NewGuid():N}"[..38] : Clean(photo.Id, 80),
            OwnerType = ownerType,
            OwnerId = ownerId,
            FileName = CleanOptional(photo.FileName, 220) ?? "photo",
            ContentType = contentType,
            Data = data,
            CreatedAt = DateTimeOffset.UtcNow
        };
    }

    private static byte[]? DecodeDataUrl(string dataUrl)
    {
        var commaIndex = dataUrl.IndexOf(',', StringComparison.Ordinal);
        var base64 = commaIndex >= 0 ? dataUrl[(commaIndex + 1)..] : dataUrl;
        try
        {
            return Convert.FromBase64String(base64);
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static List<LitterPickAreaDto> DeserializeAreas(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<List<LitterPickAreaDto>>(json, JsonOptions) ?? new List<LitterPickAreaDto>();
        }
        catch (JsonException)
        {
            return new List<LitterPickAreaDto>();
        }
    }

    private static string MapLinkFor(double lat, double lng)
    {
        var latText = lat.ToString("F5", CultureInfo.InvariantCulture);
        var lngText = lng.ToString("F5", CultureInfo.InvariantCulture);
        return $"https://www.openstreetmap.org/?mlat={latText}&mlon={lngText}#map=17/{latText}/{lngText}";
    }

    private static string Clean(string? value, int maxLength)
    {
        var cleaned = (value ?? string.Empty).Trim();
        return cleaned.Length <= maxLength ? cleaned : cleaned[..maxLength];
    }

    private static string? CleanOptional(string? value, int maxLength)
    {
        var cleaned = Clean(value, maxLength);
        return string.IsNullOrWhiteSpace(cleaned) ? null : cleaned;
    }
}
