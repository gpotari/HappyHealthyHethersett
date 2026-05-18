namespace HappyHealthyHethersett.Api.Domain;

public class LitterPickAttendanceEntity
{
    public string LitterPickEventId { get; set; } = string.Empty;
    public LitterPickEventEntity? LitterPickEvent { get; set; }
    public Guid UserId { get; set; }
    public AppUser? User { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
