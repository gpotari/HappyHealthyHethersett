using System.Globalization;
using HappyHealthyHethersett.Api.Data;
using HappyHealthyHethersett.Api.Domain;
using Microsoft.EntityFrameworkCore;
using WebPush;

namespace HappyHealthyHethersett.Api.Services;

public class LitterPickReminderService : BackgroundService
{
    private static readonly TimeSpan CheckInterval = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan DayReminder = TimeSpan.FromDays(1);
    private static readonly TimeSpan HourReminder = TimeSpan.FromHours(1);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<LitterPickReminderService> _logger;
    private readonly TimeZoneInfo _eventTimeZone;

    public LitterPickReminderService(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<LitterPickReminderService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _eventTimeZone = ResolveTimeZone(configuration["Notifications:TimeZoneId"] ?? "Europe/London");
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await SendDueRemindersAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception error)
            {
                _logger.LogError(error, "Unable to process litter pick push reminders.");
            }

            await Task.Delay(CheckInterval, stoppingToken);
        }
    }

    private async Task SendDueRemindersAsync(CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var pushNotifications = scope.ServiceProvider.GetRequiredService<PushNotificationService>();
        if (!pushNotifications.IsConfigured)
        {
            return;
        }

        var now = DateTimeOffset.UtcNow;
        var events = await db.LitterPickEvents
            .AsNoTracking()
            .Where(item => item.Status == "open")
            .ToListAsync(cancellationToken);

        foreach (var litterPickEvent in events)
        {
            if (!TryGetEventStartUtc(litterPickEvent, out var eventStartUtc))
            {
                continue;
            }

            var timeUntilEvent = eventStartUtc - now;
            if (timeUntilEvent <= TimeSpan.Zero)
            {
                continue;
            }

            if (timeUntilEvent <= DayReminder && timeUntilEvent > HourReminder)
            {
                await SendReminderBatchAsync(db, pushNotifications, litterPickEvent, "day", eventStartUtc, cancellationToken);
            }

            if (timeUntilEvent <= HourReminder)
            {
                await SendReminderBatchAsync(db, pushNotifications, litterPickEvent, "hour", eventStartUtc, cancellationToken);
            }
        }
    }

    private async Task SendReminderBatchAsync(
        AppDbContext db,
        PushNotificationService pushNotifications,
        LitterPickEventEntity litterPickEvent,
        string reminderType,
        DateTimeOffset eventStartUtc,
        CancellationToken cancellationToken)
    {
        var alreadySentUserIds = await db.LitterPickReminderDeliveries
            .AsNoTracking()
            .Where(item => item.LitterPickEventId == litterPickEvent.Id && item.ReminderType == reminderType)
            .Select(item => item.UserId)
            .ToListAsync(cancellationToken);
        var userIds = await db.LitterPickAttendances
            .AsNoTracking()
            .Where(item => item.LitterPickEventId == litterPickEvent.Id && !alreadySentUserIds.Contains(item.UserId))
            .Select(item => item.UserId)
            .Distinct()
            .ToListAsync(cancellationToken);
        if (userIds.Count == 0)
        {
            return;
        }

        var subscriptions = await db.PushNotificationSubscriptions
            .Where(item => userIds.Contains(item.UserId))
            .ToListAsync(cancellationToken);
        var eventStartLocal = TimeZoneInfo.ConvertTime(eventStartUtc, _eventTimeZone);

        foreach (var userId in userIds)
        {
            var userSubscriptions = subscriptions.Where(item => item.UserId == userId).ToList();
            if (userSubscriptions.Count == 0)
            {
                continue;
            }

            foreach (var subscription in userSubscriptions)
            {
                try
                {
                    await pushNotifications.SendLitterPickReminderAsync(
                        subscription,
                        litterPickEvent,
                        reminderType,
                        eventStartLocal,
                        cancellationToken);
                    subscription.LastError = null;
                    subscription.LastErrorAt = null;
                }
                catch (WebPushException error) when (pushNotifications.IsExpiredSubscription(error))
                {
                    db.PushNotificationSubscriptions.Remove(subscription);
                }
                catch (Exception error)
                {
                    subscription.LastError = error.Message[..Math.Min(error.Message.Length, 500)];
                    subscription.LastErrorAt = DateTimeOffset.UtcNow;
                    pushNotifications.LogSendFailure(subscription, error);
                }
            }

            await db.LitterPickReminderDeliveries.AddAsync(new LitterPickReminderDeliveryEntity
            {
                LitterPickEventId = litterPickEvent.Id,
                UserId = userId,
                ReminderType = reminderType,
                SentAt = DateTimeOffset.UtcNow
            }, cancellationToken);
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    private bool TryGetEventStartUtc(LitterPickEventEntity litterPickEvent, out DateTimeOffset eventStartUtc)
    {
        eventStartUtc = default;
        if (!DateOnly.TryParseExact(litterPickEvent.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
        {
            return false;
        }

        if (!TimeOnly.TryParseExact(litterPickEvent.Start ?? "10:00", "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var start))
        {
            start = new TimeOnly(10, 0);
        }

        var localStart = DateTime.SpecifyKind(date.ToDateTime(start), DateTimeKind.Unspecified);
        eventStartUtc = TimeZoneInfo.ConvertTimeToUtc(localStart, _eventTimeZone);
        return true;
    }

    private static TimeZoneInfo ResolveTimeZone(string timeZoneId)
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.Local;
        }
        catch (InvalidTimeZoneException)
        {
            return TimeZoneInfo.Local;
        }
    }
}
