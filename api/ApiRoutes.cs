using System.Globalization;
using System.Collections.Concurrent;
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
    private static readonly HttpClient NominatimHttpClient = CreateNominatimHttpClient();
    private static readonly SemaphoreSlim NominatimRequestGate = new(1, 1);
    private static readonly ConcurrentDictionary<string, NominatimCacheItem> NominatimSearchCache = new();
    private static readonly TimeSpan NominatimCacheDuration = TimeSpan.FromHours(12);
    private static readonly TimeSpan NominatimMinimumInterval = TimeSpan.FromMilliseconds(1100);
    private static DateTimeOffset _lastNominatimRequestAt = DateTimeOffset.MinValue;
    private const string HethersettStreetViewBox = "1.12900,52.62980,1.23240,52.56600";
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
                await authService.RegisterUserAsync(request);
                return Results.Created("/api/auth/register", new
                {
                    ok = true,
                    message = "Registration complete. You can now sign in."
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

        app.MapGet("/api/notifications/config", (PushNotificationService pushNotifications) =>
        {
            return Results.Ok(new PushNotificationConfigDto(pushNotifications.IsConfigured, pushNotifications.PublicKey));
        }).AllowAnonymous();

        app.MapGet("/api/street-search", SearchStreetAsync).RequireAuthorization();

        app.MapPost("/api/notifications/subscriptions", async (
            PushSubscriptionRequest request,
            AppDbContext db,
            ClaimsPrincipal currentUser,
            PushNotificationService pushNotifications) =>
        {
            if (!pushNotifications.IsConfigured)
            {
                return Results.BadRequest(new { error = "Push notifications are not configured." });
            }

            var currentUserId = CurrentUserId(currentUser);
            if (currentUserId is null)
            {
                return Results.Unauthorized();
            }

            var endpoint = Clean(request.Endpoint, 600);
            var p256dh = Clean(request.Keys.P256dh, 256);
            var auth = Clean(request.Keys.Auth, 128);
            if (string.IsNullOrWhiteSpace(endpoint) || string.IsNullOrWhiteSpace(p256dh) || string.IsNullOrWhiteSpace(auth))
            {
                return Results.BadRequest(new { error = "Invalid push subscription." });
            }

            var now = DateTimeOffset.UtcNow;
            var subscription = await db.PushNotificationSubscriptions.SingleOrDefaultAsync(item => item.Endpoint == endpoint);
            if (subscription is null)
            {
                subscription = new PushNotificationSubscriptionEntity
                {
                    Endpoint = endpoint,
                    CreatedAt = now
                };
                await db.PushNotificationSubscriptions.AddAsync(subscription);
            }

            subscription.UserId = currentUserId.Value;
            subscription.P256dh = p256dh;
            subscription.Auth = auth;
            subscription.ExpiresAt = request.ExpirationTime.HasValue
                ? DateTimeOffset.FromUnixTimeMilliseconds(request.ExpirationTime.Value)
                : null;
            subscription.UpdatedAt = now;
            subscription.LastError = null;
            subscription.LastErrorAt = null;
            await db.SaveChangesAsync();

            return Results.Ok(new { ok = true });
        }).RequireAuthorization();

        app.MapPost("/api/notifications/test", async (
            PushNotificationTestRequest request,
            AppDbContext db,
            ClaimsPrincipal currentUser,
            PushNotificationService pushNotifications,
            CancellationToken cancellationToken) =>
        {
            if (!pushNotifications.IsConfigured)
            {
                return Results.BadRequest(new { error = "Push notifications are not configured." });
            }

            var currentUserId = CurrentUserId(currentUser);
            if (currentUserId is null)
            {
                return Results.Unauthorized();
            }

            var endpoint = CleanOptional(request.Endpoint, 600);
            var testId = CleanOptional(request.TestId, 80);
            var query = db.PushNotificationSubscriptions
                .Where(item => item.UserId == currentUserId.Value);
            if (!string.IsNullOrWhiteSpace(endpoint))
            {
                query = query.Where(item => item.Endpoint == endpoint);
            }

            var subscriptions = await query
                .OrderByDescending(item => item.UpdatedAt)
                .ToListAsync(cancellationToken);
            if (subscriptions.Count == 0)
            {
                return Results.BadRequest(new { error = "Turn on reminders in this browser, then try again." });
            }

            var sent = 0;
            foreach (var subscription in subscriptions)
            {
                try
                {
                    await pushNotifications.SendTestNotificationAsync(subscription, testId, cancellationToken);
                    subscription.LastError = null;
                    subscription.LastErrorAt = null;
                    sent += 1;
                }
                catch (WebPush.WebPushException error) when (pushNotifications.IsExpiredSubscription(error))
                {
                    db.PushNotificationSubscriptions.Remove(subscription);
                }
                catch (Exception error)
                {
                    subscription.LastError = Clean(error.Message, 500);
                    subscription.LastErrorAt = DateTimeOffset.UtcNow;
                    pushNotifications.LogSendFailure(subscription, error);
                }
            }

            await db.SaveChangesAsync(cancellationToken);
            if (sent == 0)
            {
                return Results.BadRequest(new { error = "No test notification could be sent. Please try the button again." });
            }

            return Results.Ok(new PushNotificationTestResponse(true, sent));
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

        app.MapDelete("/api/users/{id:guid}", async (Guid id, AuthService authService, ClaimsPrincipal currentUser) =>
        {
            if (IsSelfDelete(id, currentUser))
            {
                return Results.BadRequest(new { error = "You cannot delete your own account." });
            }

            var deleted = await authService.DeleteUserAsync(id);
            return deleted ? Results.NoContent() : Results.NotFound();
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

        app.MapGet("/api/events", async (AppDbContext db, ClaimsPrincipal currentUser) =>
        {
            var events = await db.Events
                .AsNoTracking()
                .Include(item => item.CreatedByUser)
                .Include(item => item.UpdatedByUser)
                .OrderBy(item => item.SortOrder)
                .ToListAsync();
            var eventIds = events.Select(EventOwnerId).ToArray();
            var attendanceCounts = CurrentUserIsStaff(currentUser)
                ? await EventAttendanceCountsAsync(db, eventIds)
                : new Dictionary<string, int>(StringComparer.Ordinal);
            var currentUserId = CurrentUserId(currentUser);
            var attendingEventIds = currentUserId is null
                ? new HashSet<string>(StringComparer.Ordinal)
                : (await db.EventAttendances
                    .AsNoTracking()
                    .Where(item => item.UserId == currentUserId.Value && eventIds.Contains(item.EventId))
                    .Select(item => item.EventId)
                    .ToListAsync())
                    .ToHashSet(StringComparer.Ordinal);
            var photos = await db.StoredPhotos
                .AsNoTracking()
                .Where(photo => photo.OwnerType == CommunityEventPhotoOwner && eventIds.Contains(photo.OwnerId))
                .OrderBy(photo => photo.CreatedAt)
                .ToListAsync();
            var photosByEvent = photos.GroupBy(photo => photo.OwnerId).ToDictionary(group => group.Key, group => group.ToList());
            return Results.Ok(events.Select(item => ToEventDto(
                item,
                photosByEvent.GetValueOrDefault(EventOwnerId(item)) ?? new List<StoredPhotoEntity>(),
                CurrentUserIsStaff(currentUser) ? attendanceCounts.GetValueOrDefault(EventOwnerId(item)) : null,
                attendingEventIds.Contains(EventOwnerId(item)))));
        }).AllowAnonymous();

        app.MapGet("/api/events/attendance", async (AppDbContext db, ClaimsPrincipal currentUser) =>
        {
            var currentUserId = CurrentUserId(currentUser);
            if (currentUserId is null)
            {
                return Results.Unauthorized();
            }

            var eventIds = await db.EventAttendances
                .AsNoTracking()
                .Where(item => item.UserId == currentUserId.Value)
                .Select(item => item.EventId)
                .OrderBy(id => id)
                .ToArrayAsync();
            return Results.Ok(new EventAttendanceListResponse(eventIds));
        }).RequireAuthorization();

        app.MapPut("/api/events/{id}/attendance", async (
            string id,
            EventAttendanceRequest request,
            AppDbContext db,
            ClaimsPrincipal currentUser) =>
        {
            var eventId = Clean(id, 80);
            var currentUserId = CurrentUserId(currentUser);
            if (currentUserId is null)
            {
                return Results.Unauthorized();
            }

            var communityEvent = await db.Events
                .AsNoTracking()
                .SingleOrDefaultAsync(item => item.PublicId == eventId);
            if (communityEvent is null)
            {
                return Results.NotFound();
            }

            var existingAttendance = await db.EventAttendances.SingleOrDefaultAsync(item =>
                item.EventId == eventId && item.UserId == currentUserId.Value);
            if (request.Attending && existingAttendance is null)
            {
                await db.EventAttendances.AddAsync(new EventAttendanceEntity
                {
                    EventId = eventId,
                    UserId = currentUserId.Value
                });
            }
            else if (!request.Attending && existingAttendance is not null)
            {
                db.EventAttendances.Remove(existingAttendance);
            }

            await db.SaveChangesAsync();
            return Results.Ok(new EventAttendanceResponse(eventId, request.Attending));
        }).RequireAuthorization();

        app.MapPut("/api/events", async (List<EventDto> events, AppDbContext db, ClaimsPrincipal currentUser) =>
        {
            var currentUserId = CurrentUserId(currentUser);
            var existingEventList = await db.Events.AsNoTracking().ToListAsync();
            var existingEvents = existingEventList.ToDictionary(EventOwnerId, StringComparer.Ordinal);
            var incomingEventIds = events
                .Select(item => CleanOptional(item.Id, 80))
                .OfType<string>()
                .ToHashSet(StringComparer.Ordinal);
            var deletedEventIds = existingEvents.Keys.Except(incomingEventIds, StringComparer.Ordinal).ToArray();
            if (!CurrentUserIsAdmin(currentUser) && RemovesExistingCommunityEvent(events, existingEvents))
            {
                return Results.Forbid();
            }

            await using var transaction = await db.Database.BeginTransactionAsync();
            db.Events.RemoveRange(await db.Events.ToListAsync());
            if (deletedEventIds.Length > 0)
            {
                db.EventAttendances.RemoveRange(await db.EventAttendances
                    .Where(item => deletedEventIds.Contains(item.EventId))
                    .ToListAsync());
            }
            db.StoredPhotos.RemoveRange(await db.StoredPhotos.Where(photo => photo.OwnerType == CommunityEventPhotoOwner).ToListAsync());
            var eventEntities = events.Select((item, index) => ToEventEntity(item, index, currentUserId, existingEvents)).ToList();
            var photoEntities = events
                .SelectMany((item, index) => ToPhotoEntities(CommunityEventPhotoOwner, eventEntities[index].PublicId, item.Photos))
                .ToList();
            await db.Events.AddRangeAsync(eventEntities);
            await db.StoredPhotos.AddRangeAsync(photoEntities);
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            var savedEvents = await db.Events
                .AsNoTracking()
                .Include(item => item.CreatedByUser)
                .Include(item => item.UpdatedByUser)
                .OrderBy(item => item.SortOrder)
                .ToListAsync();
            var savedEventIds = savedEvents.Select(EventOwnerId).ToArray();
            var savedPhotos = await db.StoredPhotos
                .AsNoTracking()
                .Where(photo => photo.OwnerType == CommunityEventPhotoOwner && savedEventIds.Contains(photo.OwnerId))
                .OrderBy(photo => photo.CreatedAt)
                .ToListAsync();
            var photosByEvent = savedPhotos.GroupBy(photo => photo.OwnerId).ToDictionary(group => group.Key, group => group.ToList());
            var attendanceCounts = await EventAttendanceCountsAsync(db, savedEventIds);
            var attendingEventIds = currentUserId is null
                ? new HashSet<string>(StringComparer.Ordinal)
                : (await db.EventAttendances
                    .AsNoTracking()
                    .Where(item => item.UserId == currentUserId.Value && savedEventIds.Contains(item.EventId))
                    .Select(item => item.EventId)
                    .ToListAsync())
                    .ToHashSet(StringComparer.Ordinal);
            return Results.Ok(savedEvents.Select(item => ToEventDto(
                item,
                photosByEvent.GetValueOrDefault(EventOwnerId(item)) ?? new List<StoredPhotoEntity>(),
                attendanceCounts.GetValueOrDefault(EventOwnerId(item)),
                attendingEventIds.Contains(EventOwnerId(item)))));
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
                .OrderBy(item => item.State == "addressed" ? 1 : 0)
                .ThenByDescending(item => item.CreatedAt)
                .ToListAsync();
            var reportIds = reports.Select(item => item.Id).ToArray();
            var photos = await db.StoredPhotos
                .AsNoTracking()
                .Where(photo => photo.OwnerType == LitterReportPhotoOwner && reportIds.Contains(photo.OwnerId))
                .OrderBy(photo => photo.CreatedAt)
                .ToListAsync();
            var photosByReport = photos.GroupBy(photo => photo.OwnerId).ToDictionary(group => group.Key, group => group.ToList());
            return Results.Ok(reports.Select(report => ToLitterReportDto(report, photosByReport.GetValueOrDefault(report.Id) ?? new List<StoredPhotoEntity>())));
        }).RequireAuthorization(AppRoles.AdminOnlyPolicy);

        app.MapPut("/api/litter-reports/{id}/state", async (
            string id,
            UpdateLitterReportStateRequest request,
            AppDbContext db) =>
        {
            var reportId = Clean(id, 80);
            var report = await db.LitterReports.SingleOrDefaultAsync(item => item.Id == reportId);
            if (report is null)
            {
                return Results.NotFound();
            }

            report.State = NormalizeReportState(request.State);
            await db.SaveChangesAsync();
            var photos = await db.StoredPhotos
                .AsNoTracking()
                .Where(photo => photo.OwnerType == LitterReportPhotoOwner && photo.OwnerId == report.Id)
                .OrderBy(photo => photo.CreatedAt)
                .ToListAsync();
            return Results.Ok(ToLitterReportDto(report, photos));
        }).RequireAuthorization(AppRoles.AdminOnlyPolicy);

        app.MapDelete("/api/litter-reports/{id}", async (string id, AppDbContext db) =>
        {
            var reportId = Clean(id, 80);
            var report = await db.LitterReports.SingleOrDefaultAsync(item => item.Id == reportId);
            if (report is null)
            {
                return Results.NotFound();
            }

            db.LitterReports.Remove(report);
            db.StoredPhotos.RemoveRange(await db.StoredPhotos
                .Where(photo => photo.OwnerType == LitterReportPhotoOwner && photo.OwnerId == report.Id)
                .ToListAsync());
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequireAuthorization(AppRoles.AdminOnlyPolicy);

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
        }).RequireAuthorization(AppRoles.AdminOnlyPolicy);

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
        }).RequireAuthorization(AppRoles.AdminOnlyPolicy);

        app.MapGet("/api/litter-pick-events", async (AppDbContext db) =>
        {
            var events = await db.LitterPickEvents
                .AsNoTracking()
                .Include(item => item.CreatedByUser)
                .Include(item => item.UpdatedByUser)
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
                .Include(item => item.CreatedByUser)
                .Include(item => item.UpdatedByUser)
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

        app.MapPut("/api/litter-pick-events", async (List<LitterPickEventDto> events, AppDbContext db, ClaimsPrincipal currentUser) =>
        {
            var currentUserId = CurrentUserId(currentUser);
            var existingEvents = await db.LitterPickEvents.ToDictionaryAsync(item => item.Id);
            var eventEntities = events.Select(item => ToLitterPickEventEntity(item, currentUserId, existingEvents)).ToList();
            var eventIds = eventEntities.Select(item => item.Id).ToArray();
            var deletedEventIds = existingEvents.Keys.Except(eventIds, StringComparer.Ordinal).ToArray();
            if (!CurrentUserIsAdmin(currentUser) && deletedEventIds.Length > 0)
            {
                return Results.Forbid();
            }

            await using var transaction = await db.Database.BeginTransactionAsync();
            if (deletedEventIds.Length > 0)
            {
                db.LitterPickAttendances.RemoveRange(await db.LitterPickAttendances
                    .Where(item => deletedEventIds.Contains(item.LitterPickEventId))
                    .ToListAsync());
                db.LitterPickReminderDeliveries.RemoveRange(await db.LitterPickReminderDeliveries
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
                    UpdateLitterPickEventEntity(existingEvent, eventEntity, currentUserId);
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
                .Include(item => item.CreatedByUser)
                .Include(item => item.UpdatedByUser)
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

    private static bool IsSelfDelete(Guid id, ClaimsPrincipal currentUser)
    {
        var currentIdText = currentUser.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(currentIdText, out var currentId) && currentId == id;
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

    private static bool CurrentUserIsAdmin(ClaimsPrincipal currentUser)
    {
        return currentUser.IsInRole(AppRoles.Admin);
    }

    private static bool CurrentUserIsStaff(ClaimsPrincipal currentUser)
    {
        return currentUser.IsInRole(AppRoles.Admin) || currentUser.IsInRole(AppRoles.Editor);
    }

    private static bool RemovesExistingCommunityEvent(List<EventDto> events, IReadOnlyDictionary<string, CommunityEvent> existingEvents)
    {
        var incomingIds = events
            .Select(item => CleanOptional(item.Id, 80))
            .OfType<string>()
            .ToHashSet(StringComparer.Ordinal);
        return existingEvents.Keys.Any(id => !incomingIds.Contains(id));
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

    private static EventCreatorDto? ToEventCreatorDto(AppUser? user)
    {
        return user is null
            ? null
            : new EventCreatorDto(user.Id, user.DisplayName, AuthService.AvatarDataUrl(user));
    }

    private static EventDto ToEventDto(
        CommunityEvent item,
        List<StoredPhotoEntity> photos,
        int? registeredCount = null,
        bool? isAttending = null)
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
            Photos = photos.Select(ToPhotoDto).ToList(),
            RegisteredCount = registeredCount,
            IsAttending = isAttending,
            CreatedAt = item.CreatedAt,
            CreatedBy = ToEventCreatorDto(item.CreatedByUser),
            UpdatedAt = item.UpdatedAt,
            UpdatedBy = ToEventCreatorDto(item.UpdatedByUser)
        };
    }

    private static CommunityEvent ToEventEntity(
        EventDto item,
        int index,
        Guid? currentUserId,
        IReadOnlyDictionary<string, CommunityEvent> existingEvents)
    {
        var publicId = CleanOptional(item.Id, 80) ?? $"event-{Guid.NewGuid():N}"[..38];
        existingEvents.TryGetValue(publicId, out var existingEvent);
        var now = DateTimeOffset.UtcNow;
        var changed = existingEvent is null || CommunityEventChanged(item, existingEvent);
        return new CommunityEvent
        {
            PublicId = publicId,
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
            ImageAlt = CleanOptional(item.ImageAlt, 260),
            CreatedAt = existingEvent?.CreatedAt ?? now,
            CreatedByUserId = existingEvent?.CreatedByUserId ?? currentUserId,
            UpdatedAt = changed ? now : existingEvent?.UpdatedAt ?? now,
            UpdatedByUserId = changed ? currentUserId : existingEvent?.UpdatedByUserId
        };
    }

    private static bool CommunityEventChanged(EventDto source, CommunityEvent target)
    {
        return Clean(source.Title, 220) != target.Title
            || Clean(source.Date, 40) != target.Date
            || Clean(source.Start, 40) != target.Start
            || Clean(source.End, 40) != target.End
            || CleanOptional(source.Location, 220) != target.Location
            || Clean(source.Description, 5000) != target.Description
            || CleanOptional(source.CtaLabel, 120) != target.CtaLabel
            || CleanOptional(source.CtaHref, 1200) != target.CtaHref
            || CleanOptional(source.Note, 500) != target.Note
            || CleanOptional(source.Phone, 80) != target.Phone
            || CleanOptional(source.ImageUrl, 1_500_000) != target.ImageUrl
            || CleanOptional(source.ImageAlt, 260) != target.ImageAlt;
    }

    private static string EventOwnerId(CommunityEvent item)
    {
        return string.IsNullOrWhiteSpace(item.PublicId) ? $"event-{item.Id}" : item.PublicId;
    }

    private static async Task<Dictionary<string, int>> EventAttendanceCountsAsync(AppDbContext db, string[] eventIds)
    {
        if (eventIds.Length == 0)
        {
            return new Dictionary<string, int>(StringComparer.Ordinal);
        }

        return await db.EventAttendances
            .AsNoTracking()
            .Where(item => eventIds.Contains(item.EventId))
            .GroupBy(item => item.EventId)
            .Select(group => new { EventId = group.Key, Count = group.Count() })
            .ToDictionaryAsync(item => item.EventId, item => item.Count, StringComparer.Ordinal);
    }

    private static LitterReportDto ToLitterReportDto(LitterReportEntity report, List<StoredPhotoEntity> photos)
    {
        return new LitterReportDto
        {
            Id = report.Id,
            CreatedAt = report.CreatedAt,
            State = NormalizeReportState(report.State),
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
            State = "new",
            LocationLabel = CleanOptional(payload.LocationLabel, 80) ?? "Selected map point",
            Lat = payload.Lat,
            Lng = payload.Lng,
            Amount = amount is not null && allowedAmounts.Contains(amount) ? amount : null,
            Comment = CleanOptional(payload.Comment, 1200),
            Contact = CleanOptional(payload.Contact, 180),
            MapLink = MapLinkFor(payload.Lat, payload.Lng)
        };
    }

    private static string NormalizeReportState(string? state)
    {
        return string.Equals(state?.Trim(), "addressed", StringComparison.OrdinalIgnoreCase)
            ? "addressed"
            : "new";
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
            UpdatedAt = item.UpdatedAt,
            CreatedBy = ToEventCreatorDto(item.CreatedByUser),
            UpdatedBy = ToEventCreatorDto(item.UpdatedByUser)
        };
    }

    private static LitterPickEventEntity ToLitterPickEventEntity(
        LitterPickEventDto item,
        Guid? currentUserId,
        IReadOnlyDictionary<string, LitterPickEventEntity> existingEvents)
    {
        var now = DateTimeOffset.UtcNow;
        var id = string.IsNullOrWhiteSpace(item.Id) ? $"litter-pick-{Guid.NewGuid():N}"[..24] : Clean(item.Id, 80);
        existingEvents.TryGetValue(id, out var existingEvent);
        return new LitterPickEventEntity
        {
            Id = id,
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
            CreatedAt = existingEvent?.CreatedAt ?? now,
            UpdatedAt = item.UpdatedAt ?? existingEvent?.UpdatedAt ?? now,
            CreatedByUserId = existingEvent?.CreatedByUserId ?? currentUserId,
            UpdatedByUserId = currentUserId
        };
    }

    private static void UpdateLitterPickEventEntity(LitterPickEventEntity target, LitterPickEventEntity source, Guid? currentUserId)
    {
        var changed = LitterPickEventChanged(target, source) || source.UpdatedAt > target.UpdatedAt.AddSeconds(1);
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
        if (changed)
        {
            target.UpdatedAt = DateTimeOffset.UtcNow;
            target.UpdatedByUserId = currentUserId;
        }
    }

    private static bool LitterPickEventChanged(LitterPickEventEntity target, LitterPickEventEntity source)
    {
        return target.Title != source.Title
            || target.Date != source.Date
            || target.Start != source.Start
            || target.End != source.End
            || target.Description != source.Description
            || target.MeetingPoint != source.MeetingPoint
            || target.MeetingPointLat != source.MeetingPointLat
            || target.MeetingPointLng != source.MeetingPointLng
            || target.Capacity != source.Capacity
            || target.WhatToBring != source.WhatToBring
            || target.EquipmentProvided != source.EquipmentProvided
            || target.Difficulty != source.Difficulty
            || target.FamilyFriendly != source.FamilyFriendly
            || target.AccessibilityNotes != source.AccessibilityNotes
            || target.WeatherPlan != source.WeatherPlan
            || target.ContactName != source.ContactName
            || target.ContactEmail != source.ContactEmail
            || target.ContactPhone != source.ContactPhone
            || target.BagsGoal != source.BagsGoal
            || target.VolunteersGoal != source.VolunteersGoal
            || target.Notes != source.Notes
            || target.Status != source.Status
            || target.AreasJson != source.AreasJson;
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

    private static async Task<IResult> SearchStreetAsync(HttpContext httpContext, CancellationToken cancellationToken)
    {
        var rawQuery = CleanOptional(httpContext.Request.Query["q"].ToString(), 220);
        if (string.IsNullOrWhiteSpace(rawQuery))
        {
            return Results.BadRequest(new { error = "Street search query is required." });
        }

        var searchQuery = rawQuery.Contains("Hethersett", StringComparison.OrdinalIgnoreCase)
            ? rawQuery
            : $"{rawQuery}, Hethersett, Norfolk, United Kingdom";
        var parameters = new Dictionary<string, string>
        {
            ["format"] = "jsonv2",
            ["q"] = searchQuery,
            ["addressdetails"] = "1",
            ["polygon_geojson"] = "1",
            ["countrycodes"] = "gb",
            ["limit"] = NominatimLimit(httpContext.Request.Query["limit"].ToString()).ToString(CultureInfo.InvariantCulture),
            ["dedupe"] = httpContext.Request.Query["dedupe"].ToString() == "1" ? "1" : "0",
            ["bounded"] = "1",
            ["viewbox"] = HethersettStreetViewBox
        };
        var queryString = string.Join("&", parameters.Select(item =>
            $"{Uri.EscapeDataString(item.Key)}={Uri.EscapeDataString(item.Value)}"));

        if (TryGetCachedNominatimResult(queryString, out var cachedJson))
        {
            return Results.Content(cachedJson, "application/json");
        }

        await NominatimRequestGate.WaitAsync(cancellationToken);
        try
        {
            if (TryGetCachedNominatimResult(queryString, out cachedJson))
            {
                return Results.Content(cachedJson, "application/json");
            }

            var waitTime = NominatimMinimumInterval - (DateTimeOffset.UtcNow - _lastNominatimRequestAt);
            if (waitTime > TimeSpan.Zero)
            {
                await Task.Delay(waitTime, cancellationToken);
            }

            using var response = await NominatimHttpClient.GetAsync($"search?{queryString}", cancellationToken);
            _lastNominatimRequestAt = DateTimeOffset.UtcNow;
            var content = await response.Content.ReadAsStringAsync(cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return Results.Problem("Street search is unavailable right now.", statusCode: (int)response.StatusCode);
            }

            NominatimSearchCache[queryString] = new NominatimCacheItem(DateTimeOffset.UtcNow, content);
            return Results.Content(content, "application/json");
        }
        finally
        {
            NominatimRequestGate.Release();
        }
    }

    private static bool TryGetCachedNominatimResult(string key, out string json)
    {
        if (NominatimSearchCache.TryGetValue(key, out var cached) &&
            DateTimeOffset.UtcNow - cached.CachedAt <= NominatimCacheDuration)
        {
            json = cached.Json;
            return true;
        }

        json = string.Empty;
        return false;
    }

    private static int NominatimLimit(string? value)
    {
        return int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? Math.Clamp(parsed, 1, 20)
            : 20;
    }

    private static HttpClient CreateNominatimHttpClient()
    {
        var client = new HttpClient
        {
            BaseAddress = new Uri("https://nominatim.openstreetmap.org/")
        };
        client.DefaultRequestHeaders.Accept.ParseAdd("application/json");
        client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "HappyHealthyHethersett/1.0 (https://happyhealthyhethersett.org)");
        client.DefaultRequestHeaders.Referrer = new Uri("https://happyhealthyhethersett.org/");
        return client;
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

    private sealed record NominatimCacheItem(DateTimeOffset CachedAt, string Json);
}
