namespace HappyHealthyHethersett.Api.Domain;

public class LitterPickEventEntity
{
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Date { get; set; } = string.Empty;
    public string? Start { get; set; }
    public string? End { get; set; }
    public string? MeetingPoint { get; set; }
    public double? MeetingPointLat { get; set; }
    public double? MeetingPointLng { get; set; }
    public string? Notes { get; set; }
    public string Status { get; set; } = "open";
    public string AreasJson { get; set; } = "[]";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
