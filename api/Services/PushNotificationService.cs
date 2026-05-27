using System.Net;
using System.Text.Json;
using HappyHealthyHethersett.Api.Domain;
using WebPush;
using WebPushSubscription = WebPush.PushSubscription;

namespace HappyHealthyHethersett.Api.Services;

public class PushNotificationService
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<PushNotificationService> _logger;
    private readonly WebPushClient _client = new();

    public PushNotificationService(IConfiguration configuration, ILogger<PushNotificationService> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    public string? PublicKey => ConfiguredValue("Notifications:VapidPublicKey", "HHH_VAPID_PUBLIC_KEY");

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(PublicKey)
        && !string.IsNullOrWhiteSpace(PrivateKey)
        && !string.IsNullOrWhiteSpace(VapidSubject);

    private string? PrivateKey => ConfiguredValue("Notifications:VapidPrivateKey", "HHH_VAPID_PRIVATE_KEY");

    private string? VapidSubject =>
        ConfiguredValue("Notifications:VapidSubject", "HHH_VAPID_SUBJECT")
        ?? "mailto:admin@happyhealthyhethersett.local";

    public async Task SendLitterPickReminderAsync(
        PushNotificationSubscriptionEntity subscription,
        LitterPickEventEntity litterPickEvent,
        string reminderType,
        DateTimeOffset eventStart,
        CancellationToken cancellationToken)
    {
        if (!IsConfigured)
        {
            return;
        }

        var title = reminderType == "day" ? "Litter pick tomorrow" : "Litter pick soon";
        var body = reminderType == "day"
            ? $"Community litter pick tomorrow at {eventStart:HH:mm}. Meet at {MeetingPoint(litterPickEvent)}."
            : $"Community litter pick starts at {eventStart:HH:mm}. Meet at {MeetingPoint(litterPickEvent)}.";
        var payload = JsonSerializer.Serialize(new
        {
            title,
            body,
            url = "/#litter-picks",
            tag = $"litter-pick-{litterPickEvent.Id}-{reminderType}"
        });
        var webPushSubscription = new WebPushSubscription(subscription.Endpoint, subscription.P256dh, subscription.Auth);
        var vapidDetails = new VapidDetails(VapidSubject, PublicKey, PrivateKey);

        await _client.SendNotificationAsync(webPushSubscription, payload, vapidDetails, cancellationToken);
    }

    public async Task SendTestNotificationAsync(
        PushNotificationSubscriptionEntity subscription,
        string? testId,
        CancellationToken cancellationToken)
    {
        if (!IsConfigured)
        {
            return;
        }

        var payload = JsonSerializer.Serialize(new
        {
            title = "Litter pick reminders are working",
            body = "You will get reminders 1 day and 1 hour before litter picks you are counted in for.",
            url = "/#litter-picks",
            testId,
            tag = string.IsNullOrWhiteSpace(testId) ? "litter-pick-test" : $"litter-pick-test-{testId}"
        });
        var webPushSubscription = new WebPushSubscription(subscription.Endpoint, subscription.P256dh, subscription.Auth);
        var vapidDetails = new VapidDetails(VapidSubject, PublicKey, PrivateKey);

        await _client.SendNotificationAsync(webPushSubscription, payload, vapidDetails, cancellationToken);
    }

    public bool IsExpiredSubscription(WebPushException error)
    {
        return error.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone;
    }

    public void LogSendFailure(PushNotificationSubscriptionEntity subscription, Exception error)
    {
        _logger.LogWarning(error, "Unable to send push notification to subscription {Endpoint}.", subscription.Endpoint);
    }

    private static string MeetingPoint(LitterPickEventEntity litterPickEvent)
    {
        return string.IsNullOrWhiteSpace(litterPickEvent.MeetingPoint)
            ? "the meeting point"
            : litterPickEvent.MeetingPoint;
    }

    private string? ConfiguredValue(string key, string environmentVariable)
    {
        return Environment.GetEnvironmentVariable(environmentVariable)
            ?? _configuration[key];
    }
}
