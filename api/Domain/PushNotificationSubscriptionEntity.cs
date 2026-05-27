namespace HappyHealthyHethersett.Api.Domain;

public class PushNotificationSubscriptionEntity
{
    public string Endpoint { get; set; } = string.Empty;
    public Guid UserId { get; set; }
    public AppUser? User { get; set; }
    public string P256dh { get; set; } = string.Empty;
    public string Auth { get; set; } = string.Empty;
    public DateTimeOffset? ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LastErrorAt { get; set; }
    public string? LastError { get; set; }
}
