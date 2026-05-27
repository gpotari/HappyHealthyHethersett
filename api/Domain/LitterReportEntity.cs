namespace HappyHealthyHethersett.Api.Domain;

public class LitterReportEntity
{
    public string Id { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public string State { get; set; } = "new";
    public string LocationLabel { get; set; } = string.Empty;
    public double Lat { get; set; }
    public double Lng { get; set; }
    public string? Amount { get; set; }
    public string? Comment { get; set; }
    public string? Contact { get; set; }
    public string MapLink { get; set; } = string.Empty;
}
