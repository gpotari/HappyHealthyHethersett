using System.Text.Json.Serialization;

namespace HappyHealthyHethersett.Api.Models;

public record LoginRequest(string Email, string Password, bool RememberMe = false);

public record RegisterRequest(string Email, string DisplayName, string Password);

public class ContactMessageRequest
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("email")]
    public string Email { get; set; } = string.Empty;

    [JsonPropertyName("subject")]
    public string? Subject { get; set; }

    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;

    [JsonPropertyName("photos")]
    public List<PhotoDto> Photos { get; set; } = new();
}

public class FeedbackMessageDto
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("email")]
    public string Email { get; set; } = string.Empty;

    [JsonPropertyName("subject")]
    public string? Subject { get; set; }

    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;

    [JsonPropertyName("photos")]
    public List<PhotoDto> Photos { get; set; } = new();
}

public record CurrentUserDto(Guid Id, string Email, string DisplayName, string[] Roles, string? AvatarDataUrl);

public record LoginResponseDto(CurrentUserDto User, string Token, DateTimeOffset ExpiresAt);

public record CreateUserRequest(string Email, string DisplayName, string Password, string[]? Roles);

public record UpdateUserRequest(string DisplayName, string[]? Roles, bool IsDisabled);

public record ResetPasswordRequest(string Password);

public record ChangePasswordRequest(string CurrentPassword, string NewPassword);

public record UpdateAccountRequest(string DisplayName, PhotoDto? Avatar, bool ClearAvatar = false);

public record UserDto(Guid Id, string Email, string DisplayName, string[] Roles, bool IsDisabled, DateTimeOffset CreatedAt, DateTimeOffset? LastLoginAt, string? AvatarDataUrl);

public record EventCreatorDto(Guid Id, string DisplayName, string? AvatarDataUrl);

public record UpdateLitterReportStateRequest(string State);

public record EventAttendanceRequest(bool Attending);

public record EventAttendanceResponse(string EventId, bool Attending);

public record EventAttendanceListResponse(string[] EventIds);

public record LitterPickAttendanceRequest(bool Attending);

public record LitterPickAttendanceResponse(string EventId, bool Attending);

public record LitterPickAttendanceListResponse(string[] EventIds);

public record PushNotificationConfigDto(bool Enabled, string? PublicKey);

public record PushNotificationTestRequest(string? Endpoint, string? TestId);

public record PushNotificationTestResponse(bool Ok, int Sent);

public class PushSubscriptionRequest
{
    [JsonPropertyName("endpoint")]
    public string Endpoint { get; set; } = string.Empty;

    [JsonPropertyName("expirationTime")]
    public long? ExpirationTime { get; set; }

    [JsonPropertyName("keys")]
    public PushSubscriptionKeysDto Keys { get; set; } = new();
}

public class PushSubscriptionKeysDto
{
    [JsonPropertyName("p256dh")]
    public string P256dh { get; set; } = string.Empty;

    [JsonPropertyName("auth")]
    public string Auth { get; set; } = string.Empty;
}

public class PhotoDto
{
    [JsonPropertyName("id")]
    public string? Id { get; set; }

    [JsonPropertyName("fileName")]
    public string FileName { get; set; } = string.Empty;

    [JsonPropertyName("contentType")]
    public string ContentType { get; set; } = string.Empty;

    [JsonPropertyName("dataUrl")]
    public string DataUrl { get; set; } = string.Empty;
}

public class EventDto
{
    [JsonPropertyName("id")]
    public string? Id { get; set; }

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("date")]
    public string Date { get; set; } = string.Empty;

    [JsonPropertyName("start")]
    public string Start { get; set; } = string.Empty;

    [JsonPropertyName("end")]
    public string End { get; set; } = string.Empty;

    [JsonPropertyName("location")]
    public string? Location { get; set; }

    [JsonPropertyName("description")]
    public string Description { get; set; } = string.Empty;

    [JsonPropertyName("ctaLabel")]
    public string? CtaLabel { get; set; }

    [JsonPropertyName("ctaHref")]
    public string? CtaHref { get; set; }

    [JsonPropertyName("note")]
    public string? Note { get; set; }

    [JsonPropertyName("phone")]
    public string? Phone { get; set; }

    [JsonPropertyName("imageUrl")]
    public string? ImageUrl { get; set; }

    [JsonPropertyName("imageAlt")]
    public string? ImageAlt { get; set; }

    [JsonPropertyName("photos")]
    public List<PhotoDto> Photos { get; set; } = new();

    [JsonPropertyName("registeredCount")]
    public int? RegisteredCount { get; set; }

    [JsonPropertyName("isAttending")]
    public bool? IsAttending { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTimeOffset? CreatedAt { get; set; }

    [JsonPropertyName("createdBy")]
    public EventCreatorDto? CreatedBy { get; set; }

    [JsonPropertyName("updatedAt")]
    public DateTimeOffset? UpdatedAt { get; set; }

    [JsonPropertyName("updatedBy")]
    public EventCreatorDto? UpdatedBy { get; set; }
}

public class LitterReportDto
{
    [JsonPropertyName("id")]
    public string? Id { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTimeOffset? CreatedAt { get; set; }

    [JsonPropertyName("state")]
    public string? State { get; set; }

    [JsonPropertyName("locationLabel")]
    public string LocationLabel { get; set; } = string.Empty;

    [JsonPropertyName("lat")]
    public double Lat { get; set; }

    [JsonPropertyName("lng")]
    public double Lng { get; set; }

    [JsonPropertyName("amount")]
    public string? Amount { get; set; }

    [JsonPropertyName("comment")]
    public string? Comment { get; set; }

    [JsonPropertyName("contact")]
    public string? Contact { get; set; }

    [JsonPropertyName("mapLink")]
    public string? MapLink { get; set; }

    [JsonPropertyName("photos")]
    public List<PhotoDto> Photos { get; set; } = new();
}

public class LitterPickAreaDto
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("label")]
    public string Label { get; set; } = string.Empty;

    [JsonPropertyName("points")]
    public List<MapPointDto>? Points { get; set; }

    [JsonPropertyName("coveragePolygons")]
    public List<List<MapPointDto>>? CoveragePolygons { get; set; }

    [JsonPropertyName("coverageItems")]
    public List<LitterPickCoverageItemDto>? CoverageItems { get; set; }

    [JsonPropertyName("x")]
    public double? X { get; set; }

    [JsonPropertyName("y")]
    public double? Y { get; set; }

    [JsonPropertyName("width")]
    public double? Width { get; set; }

    [JsonPropertyName("height")]
    public double? Height { get; set; }

    [JsonPropertyName("stickerIcon")]
    public string? StickerIcon { get; set; }

    [JsonPropertyName("stickerLabel")]
    public string? StickerLabel { get; set; }

    [JsonPropertyName("stickerColor")]
    public string? StickerColor { get; set; }

    [JsonPropertyName("stickerTint")]
    public string? StickerTint { get; set; }

    [JsonPropertyName("stickerStroke")]
    public string? StickerStroke { get; set; }

    [JsonPropertyName("bags")]
    public int Bags { get; set; }

    [JsonPropertyName("volunteers")]
    public int Volunteers { get; set; }

    [JsonPropertyName("streetNames")]
    public List<string>? StreetNames { get; set; }

    [JsonPropertyName("streets")]
    public string? Streets { get; set; }

    [JsonPropertyName("notes")]
    public string? Notes { get; set; }
}

public class LitterPickCoverageItemDto
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("kind")]
    public string Kind { get; set; } = "street";

    [JsonPropertyName("label")]
    public string? Label { get; set; }

    [JsonPropertyName("streetName")]
    public string? StreetName { get; set; }

    [JsonPropertyName("polygon")]
    public List<MapPointDto>? Polygon { get; set; }
}

public class MapPointDto
{
    [JsonPropertyName("x")]
    public double X { get; set; }

    [JsonPropertyName("y")]
    public double Y { get; set; }
}

public class LitterPickEventDto
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("date")]
    public string Date { get; set; } = string.Empty;

    [JsonPropertyName("start")]
    public string? Start { get; set; }

    [JsonPropertyName("end")]
    public string? End { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("meetingPoint")]
    public string? MeetingPoint { get; set; }

    [JsonPropertyName("meetingPointLat")]
    public double? MeetingPointLat { get; set; }

    [JsonPropertyName("meetingPointLng")]
    public double? MeetingPointLng { get; set; }

    [JsonPropertyName("capacity")]
    public int? Capacity { get; set; }

    [JsonPropertyName("registeredCount")]
    public int? RegisteredCount { get; set; }

    [JsonPropertyName("isAttending")]
    public bool? IsAttending { get; set; }

    [JsonPropertyName("whatToBring")]
    public string? WhatToBring { get; set; }

    [JsonPropertyName("equipmentProvided")]
    public string? EquipmentProvided { get; set; }

    [JsonPropertyName("difficulty")]
    public string? Difficulty { get; set; }

    [JsonPropertyName("familyFriendly")]
    public bool? FamilyFriendly { get; set; }

    [JsonPropertyName("accessibilityNotes")]
    public string? AccessibilityNotes { get; set; }

    [JsonPropertyName("weatherPlan")]
    public string? WeatherPlan { get; set; }

    [JsonPropertyName("contactName")]
    public string? ContactName { get; set; }

    [JsonPropertyName("contactEmail")]
    public string? ContactEmail { get; set; }

    [JsonPropertyName("contactPhone")]
    public string? ContactPhone { get; set; }

    [JsonPropertyName("bagsGoal")]
    public int? BagsGoal { get; set; }

    [JsonPropertyName("volunteersGoal")]
    public int? VolunteersGoal { get; set; }

    [JsonPropertyName("notes")]
    public string? Notes { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; } = "open";

    [JsonPropertyName("areas")]
    public List<LitterPickAreaDto> Areas { get; set; } = new();

    [JsonPropertyName("photos")]
    public List<PhotoDto> Photos { get; set; } = new();

    [JsonPropertyName("createdAt")]
    public DateTimeOffset? CreatedAt { get; set; }

    [JsonPropertyName("updatedAt")]
    public DateTimeOffset? UpdatedAt { get; set; }

    [JsonPropertyName("createdBy")]
    public EventCreatorDto? CreatedBy { get; set; }

    [JsonPropertyName("updatedBy")]
    public EventCreatorDto? UpdatedBy { get; set; }
}
