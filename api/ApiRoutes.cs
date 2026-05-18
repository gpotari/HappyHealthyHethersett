using System.Globalization;
using System.Net.Mail;
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
    private const string CommunityEventPhotoOwner = "CommunityEvent";
    private const string FeedbackPhotoOwner = "FeedbackMessage";
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

        app.MapPost("/api/contact", async (
            ContactMessageRequest request,
            AppDbContext db,
            HttpContext httpContext) =>
        {
            var validationError = ValidateContactMessage(request);
            if (validationError is not null)
            {
                return Results.BadRequest(new { error = validationError });
            }

            var message = new FeedbackMessageEntity
            {
                Id = $"feedback-{Guid.NewGuid():N}"[..38],
                Name = Clean(request.Name, 160),
                Email = Clean(request.Email, 320),
                Subject = CleanOptional(request.Subject, 160),
                Message = Clean(request.Message, 3000),
                IpAddress = CleanOptional(httpContext.Connection.RemoteIpAddress?.ToString(), 80),
                UserAgent = CleanOptional(httpContext.Request.Headers.UserAgent.ToString(), 500)
            };

            await db.FeedbackMessages.AddAsync(message);
            await db.StoredPhotos.AddRangeAsync(ToPhotoEntities(FeedbackPhotoOwner, message.Id, request.Photos));
            await db.SaveChangesAsync();
            return Results.Created($"/api/feedback/{message.Id}", new
            {
                ok = true,
                message = "Thanks, your message has been saved for the team."
            });
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
                .ToListAsync();
            var eventIds = events.Select(EventOwnerId).ToArray();
            var photos = await db.StoredPhotos
                .AsNoTracking()
                .Where(photo => photo.OwnerType == CommunityEventPhotoOwner && eventIds.Contains(photo.OwnerId))
                .OrderBy(photo => photo.CreatedAt)
                .ToListAsync();
            var photosByEvent = photos.GroupBy(photo => photo.OwnerId).ToDictionary(group => group.Key, group => group.ToList());
            return Results.Ok(events.Select(item => ToEventDto(item, photosByEvent.GetValueOrDefault(EventOwnerId(item)) ?? new List<StoredPhotoEntity>())));
        }).AllowAnonymous();

        app.MapPut("/api/events", async (List<EventDto> events, AppDbContext db) =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync();
            db.Events.RemoveRange(await db.Events.ToListAsync());
            db.StoredPhotos.RemoveRange(await db.StoredPhotos.Where(photo => photo.OwnerType == CommunityEventPhotoOwner).ToListAsync());
            var eventEntities = events.Select((item, index) => ToEventEntity(item, index)).ToList();
            var photoEntities = events
                .SelectMany((item, index) => ToPhotoEntities(CommunityEventPhotoOwner, eventEntities[index].PublicId, item.Photos))
                .ToList();
            await db.Events.AddRangeAsync(eventEntities);
            await db.StoredPhotos.AddRangeAsync(photoEntities);
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            var photosByEvent = photoEntities.GroupBy(photo => photo.OwnerId).ToDictionary(group => group.Key, group => group.ToList());
            return Results.Ok(eventEntities.Select(item => ToEventDto(item, photosByEvent.GetValueOrDefault(item.PublicId) ?? new List<StoredPhotoEntity>())));
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

        app.MapGet("/api/feedback", async (AppDbContext db) =>
        {
            var messages = await db.FeedbackMessages
                .AsNoTracking()
                .OrderByDescending(message => message.CreatedAt)
                .ToListAsync();
            var messageIds = messages.Select(message => message.Id).ToArray();
            var photos = await db.StoredPhotos
                .AsNoTracking()
                .Where(photo => photo.OwnerType == FeedbackPhotoOwner && messageIds.Contains(photo.OwnerId))
                .OrderBy(photo => photo.CreatedAt)
                .ToListAsync();
            var photosByMessage = photos.GroupBy(photo => photo.OwnerId).ToDictionary(group => group.Key, group => group.ToList());
            return Results.Ok(messages.Select(message => ToFeedbackMessageDto(message, photosByMessage.GetValueOrDefault(message.Id) ?? new List<StoredPhotoEntity>())));
        }).RequireAuthorization(AppRoles.StaffOnlyPolicy);

        app.MapDelete("/api/feedback/{id}", async (string id, AppDbContext db) =>
        {
            var message = await db.FeedbackMessages.SingleOrDefaultAsync(item => item.Id == id);
            if (message is null)
            {
                return Results.NotFound();
            }

            db.FeedbackMessages.Remove(message);
            db.StoredPhotos.RemoveRange(await db.StoredPhotos
                .Where(photo => photo.OwnerType == FeedbackPhotoOwner && photo.OwnerId == message.Id)
                .ToListAsync());
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequireAuthorization(AppRoles.StaffOnlyPolicy);

        app.MapGet("/api/litter-pick-events", async (AppDbContext db) =>
        {
            var events = await db.LitterPickEvents
                .AsNoTracking()
                .OrderByDescending(item => item.Date)
                .ThenByDescending(item => item.Start)
                .ToListAsync();
            var eventIds = events.Select(item => item.Id).ToArray();
            var attendanceCounts = await LitterPickAttendanceCountsAsync(db, eventIds);
            var photos = await db.StoredPhotos
                .AsNoTracking()
                .Where(photo => photo.OwnerType == LitterPickEventPhotoOwner && eventIds.Contains(photo.OwnerId))
                .OrderBy(photo => photo.CreatedAt)
                .ToListAsync();
            var photosByEvent = photos.GroupBy(photo => photo.OwnerId).ToDictionary(group => group.Key, group => group.ToList());
            return Results.Ok(events.Select(item => ToLitterPickEventDto(
                item,
                photosByEvent.GetValueOrDefault(item.Id) ?? new List<StoredPhotoEntity>(),
                attendanceCounts.GetValueOrDefault(item.Id))));
        }).RequireAuthorization(AppRoles.StaffOnlyPolicy);

        app.MapGet("/api/public/litter-pick-events", async (AppDbContext db, ClaimsPrincipal currentUser) =>
        {
            var events = await db.LitterPickEvents
                .AsNoTracking()
                .Where(item => item.Status == "open")
                .OrderBy(item => item.Date)
                .ThenBy(item => item.Start)
                .ToListAsync();
            var eventIds = events.Select(item => item.Id).ToArray();
            var currentUserId = CurrentUserId(currentUser);
            var attendingEventIds = currentUserId is null
                ? new HashSet<string>(StringComparer.Ordinal)
                : (await db.LitterPickAttendances
                    .AsNoTracking()
                    .Where(item => item.UserId == currentUserId.Value && eventIds.Contains(item.LitterPickEventId))
                    .Select(item => item.LitterPickEventId)
                    .ToListAsync())
                    .ToHashSet(StringComparer.Ordinal);
            var photos = await db.StoredPhotos
                .AsNoTracking()
                .Where(photo => photo.OwnerType == LitterPickEventPhotoOwner && eventIds.Contains(photo.OwnerId))
                .OrderBy(photo => photo.CreatedAt)
                .ToListAsync();
            var photosByEvent = photos.GroupBy(photo => photo.OwnerId).ToDictionary(group => group.Key, group => group.ToList());
            return Results.Ok(events.Select(item => ToLitterPickEventDto(
                item,
                photosByEvent.GetValueOrDefault(item.Id) ?? new List<StoredPhotoEntity>(),
                null,
                attendingEventIds.Contains(item.Id))));
        }).AllowAnonymous();

        app.MapGet("/api/litter-pick-events/attendance", async (AppDbContext db, ClaimsPrincipal currentUser) =>
        {
            var currentUserId = CurrentUserId(currentUser);
            if (currentUserId is null)
            {
                return Results.Unauthorized();
            }

            var eventIds = await db.LitterPickAttendances
                .AsNoTracking()
                .Where(item => item.UserId == currentUserId.Value)
                .Select(item => item.LitterPickEventId)
                .OrderBy(id => id)
                .ToArrayAsync();
            return Results.Ok(new LitterPickAttendanceListResponse(eventIds));
        }).RequireAuthorization();

        app.MapPut("/api/litter-pick-events/{id}/attendance", async (
            string id,
            LitterPickAttendanceRequest request,
            AppDbContext db,
            ClaimsPrincipal currentUser) =>
        {
            var eventId = Clean(id, 80);
            var currentUserId = CurrentUserId(currentUser);
            if (currentUserId is null)
            {
                return Results.Unauthorized();
            }

            var litterPickEvent = await db.LitterPickEvents.SingleOrDefaultAsync(item => item.Id == eventId);
            if (litterPickEvent is null)
            {
                return Results.NotFound();
            }

            if (litterPickEvent.Status != "open")
            {
                return Results.BadRequest(new { error = "This litter pick event is no longer open for sign-ups." });
            }

            var existingAttendance = await db.LitterPickAttendances.SingleOrDefaultAsync(item =>
                item.LitterPickEventId == eventId && item.UserId == currentUserId.Value);
            if (request.Attending && existingAttendance is null)
            {
                await db.LitterPickAttendances.AddAsync(new LitterPickAttendanceEntity
                {
                    LitterPickEventId = eventId,
                    UserId = currentUserId.Value
                });
            }
            else if (!request.Attending && existingAttendance is not null)
            {
                db.LitterPickAttendances.Remove(existingAttendance);
            }

            await db.SaveChangesAsync();
            await SyncLitterPickRegisteredCountAsync(db, eventId);
            return Results.Ok(new LitterPickAttendanceResponse(eventId, request.Attending));
        }).RequireAuthorization();

        app.MapPut("/api/litter-pick-events", async (List<LitterPickEventDto> events, AppDbContext db) =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync();
            var eventEntities = events.Select(ToLitterPickEventEntity).ToList();
            var eventIds = eventEntities.Select(item => item.Id).ToArray();
            var existingEvents = await db.LitterPickEvents.ToDictionaryAsync(item => item.Id);
            var deletedEventIds = existingEvents.Keys.Except(eventIds, StringComparer.Ordinal).ToArray();

            if (deletedEventIds.Length > 0)
            {
                db.LitterPickAttendances.RemoveRange(await db.LitterPickAttendances
                    .Where(item => deletedEventIds.Contains(item.LitterPickEventId))
                    .ToListAsync());
                db.StoredPhotos.RemoveRange(await db.StoredPhotos
                    .Where(photo => photo.OwnerType == LitterPickEventPhotoOwner && deletedEventIds.Contains(photo.OwnerId))
                    .ToListAsync());
                db.LitterPickEvents.RemoveRange(deletedEventIds.Select(id => existingEvents[id]));
            }

            db.StoredPhotos.RemoveRange(await db.StoredPhotos
                .Where(photo => photo.OwnerType == LitterPickEventPhotoOwner && eventIds.Contains(photo.OwnerId))
                .ToListAsync());
            foreach (var eventEntity in eventEntities)
            {
                if (existingEvents.TryGetValue(eventEntity.Id, out var existingEvent))
                {
                    UpdateLitterPickEventEntity(existingEvent, eventEntity);
                }
                else
                {
                    await db.LitterPickEvents.AddAsync(eventEntity);
                }
            }

            await db.StoredPhotos.AddRangeAsync(events.SelectMany((item, index) =>
            {
                var ownerId = eventEntities[index].Id;
                return ToPhotoEntities(LitterPickEventPhotoOwner, ownerId, item.Photos);
            }));
            await db.SaveChangesAsync();
            await SyncLitterPickRegisteredCountsAsync(db, eventIds);
            await transaction.CommitAsync();
            var savedEvents = await db.LitterPickEvents
                .AsNoTracking()
                .OrderByDescending(item => item.Date)
                .ThenByDescending(item => item.Start)
                .ToListAsync();
            var savedEventIds = savedEvents.Select(item => item.Id).ToArray();
            var attendanceCounts = await LitterPickAttendanceCountsAsync(db, savedEventIds);
            var photos = await db.StoredPhotos
                .AsNoTracking()
                .Where(photo => photo.OwnerType == LitterPickEventPhotoOwner && savedEventIds.Contains(photo.OwnerId))
                .OrderBy(photo => photo.CreatedAt)
                .ToListAsync();
            var photosByEvent = photos.GroupBy(photo => photo.OwnerId).ToDictionary(group => group.Key, group => group.ToList());
            return Results.Ok(savedEvents.Select(item => ToLitterPickEventDto(
                item,
                photosByEvent.GetValueOrDefault(item.Id) ?? new List<StoredPhotoEntity>(),
                attendanceCounts.GetValueOrDefault(item.Id))));
        }).RequireAuthorization(AppRoles.StaffOnlyPolicy);
    }

    private static bool IsSelfLockout(Guid id, UpdateUserRequest request, ClaimsPrincipal currentUser)
    {
        var currentIdText = currentUser.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(currentIdText, out var currentId)
            && currentId == id
            && (request.IsDisabled || request.Roles?.Contains(AppRoles.Admin) != true);
    }

    private static string? ValidateContactMessage(ContactMessageRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return "Please enter your name.";
        }

        if (string.IsNullOrWhiteSpace(request.Email) || !IsValidEmail(request.Email))
        {
            return "Please enter a valid email address.";
        }

        if (string.IsNullOrWhiteSpace(request.Message))
        {
            return "Please enter a message.";
        }

        if (request.Name.Length > 160 || request.Email.Length > 320 || request.Message.Length > 3000 || (request.Subject?.Length ?? 0) > 160)
        {
            return "Please shorten your message before submitting.";
        }

        return null;
    }

    private static bool IsValidEmail(string email)
    {
        try
        {
            var address = new MailAddress(email.Trim());
            return address.Address.Equals(email.Trim(), StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
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

    private static EventDto ToEventDto(CommunityEvent item, List<StoredPhotoEntity> photos)
    {
        return new EventDto
        {
            Id = EventOwnerId(item),
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
            ImageAlt = item.ImageAlt,
            Photos = photos.Select(ToPhotoDto).ToList()
        };
    }

    private static CommunityEvent ToEventEntity(EventDto item, int index)
    {
        return new CommunityEvent
        {
            PublicId = CleanOptional(item.Id, 80) ?? $"event-{Guid.NewGuid():N}"[..38],
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

    private static string EventOwnerId(CommunityEvent item)
    {
        return string.IsNullOrWhiteSpace(item.PublicId) ? $"event-{item.Id}" : item.PublicId;
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

    private static FeedbackMessageDto ToFeedbackMessageDto(FeedbackMessageEntity message, List<StoredPhotoEntity> photos)
    {
        return new FeedbackMessageDto
        {
            Id = message.Id,
            CreatedAt = message.CreatedAt,
            Name = message.Name,
            Email = message.Email,
            Subject = message.Subject,
            Message = message.Message,
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

    private static LitterPickEventDto ToLitterPickEventDto(
        LitterPickEventEntity item,
        List<StoredPhotoEntity> photos,
        int? registeredCount,
        bool? isAttending = null)
    {
        return new LitterPickEventDto
        {
            Id = item.Id,
            Title = item.Title,
            Date = item.Date,
            Start = item.Start,
            End = item.End,
            Description = item.Description,
            MeetingPoint = item.MeetingPoint,
            MeetingPointLat = item.MeetingPointLat,
            MeetingPointLng = item.MeetingPointLng,
            Capacity = item.Capacity,
            RegisteredCount = registeredCount,
            IsAttending = isAttending,
            WhatToBring = item.WhatToBring,
            EquipmentProvided = item.EquipmentProvided,
            Difficulty = item.Difficulty,
            FamilyFriendly = item.FamilyFriendly,
            AccessibilityNotes = item.AccessibilityNotes,
            WeatherPlan = item.WeatherPlan,
            ContactName = item.ContactName,
            ContactEmail = ContactEmailFor(item.ContactEmail, item.ContactPhone),
            ContactPhone = item.ContactPhone,
            BagsGoal = item.BagsGoal,
            VolunteersGoal = item.VolunteersGoal,
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
            Title = CleanOptional(item.Title, 220) ?? DefaultLitterPickTitle(item.Date),
            Date = Clean(item.Date, 40),
            Start = CleanOptional(item.Start, 40),
            End = CleanOptional(item.End, 40),
            Description = CleanOptional(item.Description, 1400),
            MeetingPoint = CleanOptional(item.MeetingPoint, 220),
            MeetingPointLat = item.MeetingPointLat,
            MeetingPointLng = item.MeetingPointLng,
            Capacity = NonNegativeOrNull(item.Capacity),
            RegisteredCount = NonNegativeOrNull(item.RegisteredCount),
            WhatToBring = CleanOptional(item.WhatToBring, 800),
            EquipmentProvided = CleanOptional(item.EquipmentProvided, 800),
            Difficulty = CleanOptional(item.Difficulty, 40),
            FamilyFriendly = item.FamilyFriendly,
            AccessibilityNotes = CleanOptional(item.AccessibilityNotes, 1200),
            WeatherPlan = CleanOptional(item.WeatherPlan, 800),
            ContactName = CleanOptional(item.ContactName, 160),
            ContactEmail = CleanOptional(ContactEmailFor(item.ContactEmail, item.ContactPhone), 320),
            ContactPhone = CleanOptional(item.ContactPhone, 80),
            BagsGoal = NonNegativeOrNull(item.BagsGoal),
            VolunteersGoal = NonNegativeOrNull(item.VolunteersGoal),
            Notes = CleanOptional(item.Notes, 5000),
            Status = item.Status == "closed" ? "closed" : "open",
            AreasJson = JsonSerializer.Serialize(item.Areas ?? new List<LitterPickAreaDto>(), JsonOptions),
            CreatedAt = item.CreatedAt ?? now,
            UpdatedAt = now
        };
    }

    private static void UpdateLitterPickEventEntity(LitterPickEventEntity target, LitterPickEventEntity source)
    {
        target.Title = source.Title;
        target.Date = source.Date;
        target.Start = source.Start;
        target.End = source.End;
        target.Description = source.Description;
        target.MeetingPoint = source.MeetingPoint;
        target.MeetingPointLat = source.MeetingPointLat;
        target.MeetingPointLng = source.MeetingPointLng;
        target.Capacity = source.Capacity;
        target.WhatToBring = source.WhatToBring;
        target.EquipmentProvided = source.EquipmentProvided;
        target.Difficulty = source.Difficulty;
        target.FamilyFriendly = source.FamilyFriendly;
        target.AccessibilityNotes = source.AccessibilityNotes;
        target.WeatherPlan = source.WeatherPlan;
        target.ContactName = source.ContactName;
        target.ContactEmail = source.ContactEmail;
        target.ContactPhone = source.ContactPhone;
        target.BagsGoal = source.BagsGoal;
        target.VolunteersGoal = source.VolunteersGoal;
        target.Notes = source.Notes;
        target.Status = source.Status;
        target.AreasJson = source.AreasJson;
        target.UpdatedAt = DateTimeOffset.UtcNow;
    }

    private static async Task<Dictionary<string, int>> LitterPickAttendanceCountsAsync(AppDbContext db, string[] eventIds)
    {
        if (eventIds.Length == 0)
        {
            return new Dictionary<string, int>(StringComparer.Ordinal);
        }

        return await db.LitterPickAttendances
            .AsNoTracking()
            .Where(item => eventIds.Contains(item.LitterPickEventId))
            .GroupBy(item => item.LitterPickEventId)
            .Select(group => new { EventId = group.Key, Count = group.Count() })
            .ToDictionaryAsync(item => item.EventId, item => item.Count, StringComparer.Ordinal);
    }

    private static async Task<int> SyncLitterPickRegisteredCountAsync(AppDbContext db, string eventId)
    {
        var registeredCount = await db.LitterPickAttendances.CountAsync(item => item.LitterPickEventId == eventId);
        var litterPickEvent = await db.LitterPickEvents.SingleOrDefaultAsync(item => item.Id == eventId);
        if (litterPickEvent is not null)
        {
            litterPickEvent.RegisteredCount = registeredCount;
            await db.SaveChangesAsync();
        }

        return registeredCount;
    }

    private static async Task SyncLitterPickRegisteredCountsAsync(AppDbContext db, string[] eventIds)
    {
        if (eventIds.Length == 0)
        {
            return;
        }

        var attendanceCounts = await LitterPickAttendanceCountsAsync(db, eventIds);
        var events = await db.LitterPickEvents
            .Where(item => eventIds.Contains(item.Id))
            .ToListAsync();
        foreach (var litterPickEvent in events)
        {
            litterPickEvent.RegisteredCount = attendanceCounts.GetValueOrDefault(litterPickEvent.Id);
        }

        await db.SaveChangesAsync();
    }

    private static string DefaultLitterPickTitle(string? date)
    {
        var cleanedDate = CleanOptional(date, 40);
        return string.IsNullOrWhiteSpace(cleanedDate)
            ? "Community litter pick"
            : $"Community litter pick - {cleanedDate}";
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

    private static string? ContactEmailFor(string? contactEmail, string? legacyContactPhone)
    {
        var email = CleanOptional(contactEmail, 320);
        if (!string.IsNullOrWhiteSpace(email))
        {
            return email;
        }

        var legacy = CleanOptional(legacyContactPhone, 320);
        return legacy is not null && legacy.Contains('@', StringComparison.Ordinal) ? legacy : null;
    }

    private static int? NonNegativeOrNull(int? value)
    {
        return value.HasValue ? Math.Max(0, value.Value) : null;
    }
}
