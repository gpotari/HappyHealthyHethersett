using System.Text.Json.Serialization;

namespace HappyHealthyHethersett.Api.Models;

public record LoginRequest(string Email, string Password, bool RememberMe = false);

public record RegisterRequest(string Email, string DisplayName, string Password);

public record CurrentUserDto(Guid Id, string Email, string DisplayName, string[] Roles, string? AvatarDataUrl);

public record LoginResponseDto(CurrentUserDto User, string Token, DateTimeOffset ExpiresAt);

public record CreateUserRequest(string Email, string DisplayName, string Password, string[]? Roles);

public record UpdateUserRequest(string DisplayName, string[]? Roles, bool IsDisabled);

public record ResetPasswordRequest(string Password);

public record ChangePasswordRequest(string CurrentPassword, string NewPassword);

public record UpdateAccountRequest(string DisplayName, PhotoDto? Avatar, bool ClearAvatar = false);

public record UserDto(Guid Id, string Email, string DisplayName, string[] Roles, bool IsDisabled, DateTimeOffset CreatedAt, DateTimeOffset? LastLoginAt, string? AvatarDataUrl);

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
}

public class LitterReportDto
{
    [JsonPropertyName("id")]
    public string? Id { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTimeOffset? CreatedAt { get; set; }

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

    [JsonPropertyName("notes")]
    public string? Notes { get; set; }
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

    [JsonPropertyName("meetingPoint")]
    public string? MeetingPoint { get; set; }

    [JsonPropertyName("meetingPointLat")]
    public double? MeetingPointLat { get; set; }

    [JsonPropertyName("meetingPointLng")]
    public double? MeetingPointLng { get; set; }

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
}
