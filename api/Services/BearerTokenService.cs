using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using HappyHealthyHethersett.Api.Domain;
using HappyHealthyHethersett.Api.Models;

namespace HappyHealthyHethersett.Api.Services;

public class BearerTokenService
{
    public const string AuthenticationScheme = "LocalBearer";

    private const string TokenVersion = "v1";
    private readonly byte[] _signingKey;

    public BearerTokenService(IConfiguration configuration)
    {
        var configuredKey = Environment.GetEnvironmentVariable("HHH_BEARER_SIGNING_KEY")
            ?? configuration["Auth:BearerSigningKey"]
            ?? configuration.GetConnectionString("DefaultConnection")
            ?? "happy-healthy-hethersett-local-bearer-key-change-me";
        _signingKey = Encoding.UTF8.GetBytes(configuredKey);
    }

    public LoginResponseDto CreateLoginResponse(AppUser user, bool rememberMe)
    {
        var expiresAt = DateTimeOffset.UtcNow.Add(rememberMe ? TimeSpan.FromDays(14) : TimeSpan.FromHours(8));
        var roles = user.UserRoles.Select(userRole => userRole.Role.Name).OrderBy(role => role).ToArray();
        var userDto = AuthService.ToCurrentUser(user);
        var payload = new BearerTokenPayload(
            user.Id,
            user.Email,
            user.DisplayName,
            roles,
            DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            expiresAt.ToUnixTimeSeconds()
        );
        var payloadJson = JsonSerializer.Serialize(payload, JsonOptions);
        var encodedPayload = Base64UrlEncode(Encoding.UTF8.GetBytes(payloadJson));
        var signingInput = $"{TokenVersion}.{encodedPayload}";
        var signature = Sign(signingInput);

        return new LoginResponseDto(userDto, $"{signingInput}.{signature}", expiresAt);
    }

    public ClaimsPrincipal? ValidateToken(string token)
    {
        var parts = token.Split('.');
        if (parts.Length != 3 || parts[0] != TokenVersion)
        {
            return null;
        }

        var signingInput = $"{parts[0]}.{parts[1]}";
        var expectedSignature = Sign(signingInput);
        if (!CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(expectedSignature),
                Encoding.UTF8.GetBytes(parts[2])))
        {
            return null;
        }

        BearerTokenPayload? payload;
        try
        {
            payload = JsonSerializer.Deserialize<BearerTokenPayload>(Encoding.UTF8.GetString(Base64UrlDecode(parts[1])), JsonOptions);
        }
        catch (FormatException)
        {
            return null;
        }
        catch (JsonException)
        {
            return null;
        }

        if (payload is null || payload.ExpiresAt <= DateTimeOffset.UtcNow.ToUnixTimeSeconds())
        {
            return null;
        }

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, payload.Subject.ToString()),
            new(ClaimTypes.Email, payload.Email),
            new(ClaimTypes.Name, payload.DisplayName)
        };
        claims.AddRange(payload.Roles.Select(role => new Claim(ClaimTypes.Role, role)));

        var identity = new ClaimsIdentity(claims, AuthenticationScheme);
        return new ClaimsPrincipal(identity);
    }

    private string Sign(string value)
    {
        using var hmac = new HMACSHA256(_signingKey);
        return Base64UrlEncode(hmac.ComputeHash(Encoding.UTF8.GetBytes(value)));
    }

    private static string Base64UrlEncode(byte[] value)
    {
        return Convert.ToBase64String(value)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }

    private static byte[] Base64UrlDecode(string value)
    {
        var padded = value.Replace('-', '+').Replace('_', '/');
        padded = padded.PadRight(padded.Length + (4 - padded.Length % 4) % 4, '=');
        return Convert.FromBase64String(padded);
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private record BearerTokenPayload(
        Guid Subject,
        string Email,
        string DisplayName,
        string[] Roles,
        long IssuedAt,
        long ExpiresAt
    );
}
