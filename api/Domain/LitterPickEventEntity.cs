namespace HappyHealthyHethersett.Api.Domain;

public class LitterPickEventEntity
{
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Date { get; set; } = string.Empty;
    public string? Start { get; set; }
    public string? End { get; set; }
    public string? Description { get; set; }
    public string? MeetingPoint { get; set; }
    public double? MeetingPointLat { get; set; }
    public double? MeetingPointLng { get; set; }
    public int? Capacity { get; set; }
    public int? RegisteredCount { get; set; }
    public string? WhatToBring { get; set; }
    public string? EquipmentProvided { get; set; }
    public string? Difficulty { get; set; }
    public bool? FamilyFriendly { get; set; }
    public string? AccessibilityNotes { get; set; }
    public string? WeatherPlan { get; set; }
    public string? ContactName { get; set; }
    public string? ContactEmail { get; set; }
    public string? ContactPhone { get; set; }
    public int? BagsGoal { get; set; }
    public int? VolunteersGoal { get; set; }
    public string? Notes { get; set; }
    public string Status { get; set; } = "open";
    public string AreasJson { get; set; } = "[]";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public Guid? CreatedByUserId { get; set; }
    public AppUser? CreatedByUser { get; set; }
    public Guid? UpdatedByUserId { get; set; }
    public AppUser? UpdatedByUser { get; set; }
}
