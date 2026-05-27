namespace HappyHealthyHethersett.Api.Domain;

public class EventAttendanceEntity
{
    public string EventId { get; set; } = string.Empty;
    public Guid UserId { get; set; }
    public AppUser? User { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
