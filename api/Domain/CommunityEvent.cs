namespace HappyHealthyHethersett.Api.Domain;

public class CommunityEvent
{
    public int Id { get; set; }
    public int SortOrder { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Date { get; set; } = string.Empty;
    public string Start { get; set; } = string.Empty;
    public string End { get; set; } = string.Empty;
    public string? Location { get; set; }
    public string Description { get; set; } = string.Empty;
    public string? CtaLabel { get; set; }
    public string? CtaHref { get; set; }
    public string? Note { get; set; }
    public string? Phone { get; set; }
    public string? ImageUrl { get; set; }
    public string? ImageAlt { get; set; }
}
