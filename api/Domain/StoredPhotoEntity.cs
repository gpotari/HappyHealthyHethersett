namespace HappyHealthyHethersett.Api.Domain;

public class StoredPhotoEntity
{
    public string Id { get; set; } = string.Empty;
    public string OwnerType { get; set; } = string.Empty;
    public string OwnerId { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public byte[] Data { get; set; } = Array.Empty<byte>();
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
