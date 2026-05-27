namespace HappyHealthyHethersett.Api.Domain;

public class LitterPickReminderDeliveryEntity
{
    public string LitterPickEventId { get; set; } = string.Empty;
    public Guid UserId { get; set; }
    public string ReminderType { get; set; } = string.Empty;
    public DateTimeOffset SentAt { get; set; } = DateTimeOffset.UtcNow;
}
