using System.Security.Claims;
using HappyHealthyHethersett.Api.Data;
using HappyHealthyHethersett.Api.Domain;
using HappyHealthyHethersett.Api.Models;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace HappyHealthyHethersett.Api.Services;

public class AuthService
{
    private readonly AppDbContext _db;
    private readonly PasswordHasher<AppUser> _passwordHasher = new();

    public AuthService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<AppUser?> AuthenticateAsync(string email, string password)
    {
        var normalizedEmail = NormalizeEmail(email);
        var user = await _db.Users
            .Include(item => item.UserRoles)
            .ThenInclude(item => item.Role)
            .SingleOrDefaultAsync(item => item.NormalizedEmail == normalizedEmail);

        if (user is null || user.IsDisabled)
        {
            return null;
        }

        var result = _passwordHasher.VerifyHashedPassword(user, user.PasswordHash, password);
        if (result == PasswordVerificationResult.Failed)
        {
            return null;
        }

        if (result == PasswordVerificationResult.SuccessRehashNeeded)
        {
            user.PasswordHash = _passwordHasher.HashPassword(user, password);
        }

        user.LastLoginAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync();
        return user;
    }

    public async Task SignInAsync(HttpContext httpContext, AppUser user, bool rememberMe)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Email, user.Email),
            new(ClaimTypes.Name, user.DisplayName)
        };

        claims.AddRange(user.UserRoles.Select(userRole => new Claim(ClaimTypes.Role, userRole.Role.Name)));

        var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
        var principal = new ClaimsPrincipal(identity);
        var properties = new AuthenticationProperties
        {
            IsPersistent = rememberMe,
            ExpiresUtc = DateTimeOffset.UtcNow.Add(rememberMe ? TimeSpan.FromDays(14) : TimeSpan.FromHours(8))
        };

        await httpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal, properties);
    }

    public async Task<AppUser> CreateUserAsync(CreateUserRequest request)
    {
        return await CreateUserAsync(request.Email, request.DisplayName, request.Password, request.Roles, false);
    }

    public async Task<AppUser> RegisterUserAsync(RegisterRequest request)
    {
        return await CreateUserAsync(request.Email, request.DisplayName, request.Password, new[] { AppRoles.User }, false);
    }

    private async Task<AppUser> CreateUserAsync(
        string email,
        string displayName,
        string password,
        string[]? roles,
        bool isDisabled)
    {
        ValidatePassword(password);
        var normalizedEmail = NormalizeEmail(email);
        if (await _db.Users.AnyAsync(user => user.NormalizedEmail == normalizedEmail))
        {
            throw new InvalidOperationException("A user with that email already exists.");
        }

        var user = new AppUser
        {
            Email = Clean(email, 320),
            NormalizedEmail = normalizedEmail,
            DisplayName = Clean(displayName, 160),
            IsDisabled = isDisabled
        };
        if (string.IsNullOrWhiteSpace(user.DisplayName))
        {
            user.DisplayName = user.Email;
        }

        user.PasswordHash = _passwordHasher.HashPassword(user, password);
        await _db.Users.AddAsync(user);
        await ApplyRolesAsync(user, roles);
        await _db.SaveChangesAsync();
        return user;
    }

    public async Task<AppUser?> UpdateUserAsync(Guid id, UpdateUserRequest request)
    {
        var user = await _db.Users
            .Include(item => item.UserRoles)
            .ThenInclude(item => item.Role)
            .SingleOrDefaultAsync(item => item.Id == id);
        if (user is null)
        {
            return null;
        }

        user.DisplayName = Clean(request.DisplayName, 160);
        user.IsDisabled = request.IsDisabled;
        await ApplyRolesAsync(user, request.Roles);
        await _db.SaveChangesAsync();
        return user;
    }

    public async Task<bool> DeleteUserAsync(Guid id)
    {
        var user = await _db.Users.SingleOrDefaultAsync(item => item.Id == id);
        if (user is null)
        {
            return false;
        }

        await using var transaction = await _db.Database.BeginTransactionAsync();
        var attendedEventIds = await _db.LitterPickAttendances
            .Where(item => item.UserId == id)
            .Select(item => item.LitterPickEventId)
            .Distinct()
            .ToArrayAsync();

        _db.UserRoles.RemoveRange(await _db.UserRoles.Where(item => item.UserId == id).ToListAsync());
        _db.LitterPickAttendances.RemoveRange(await _db.LitterPickAttendances.Where(item => item.UserId == id).ToListAsync());
        _db.LitterPickReminderDeliveries.RemoveRange(await _db.LitterPickReminderDeliveries.Where(item => item.UserId == id).ToListAsync());
        _db.PushNotificationSubscriptions.RemoveRange(await _db.PushNotificationSubscriptions.Where(item => item.UserId == id).ToListAsync());

        var communityEvents = await _db.Events
            .Where(item => item.CreatedByUserId == id || item.UpdatedByUserId == id)
            .ToListAsync();
        foreach (var communityEvent in communityEvents)
        {
            if (communityEvent.CreatedByUserId == id)
            {
                communityEvent.CreatedByUserId = null;
            }

            if (communityEvent.UpdatedByUserId == id)
            {
                communityEvent.UpdatedByUserId = null;
            }
        }

        var litterPickEvents = await _db.LitterPickEvents
            .Where(item => item.CreatedByUserId == id || item.UpdatedByUserId == id || attendedEventIds.Contains(item.Id))
            .ToListAsync();
        foreach (var litterPickEvent in litterPickEvents)
        {
            if (litterPickEvent.CreatedByUserId == id)
            {
                litterPickEvent.CreatedByUserId = null;
            }

            if (litterPickEvent.UpdatedByUserId == id)
            {
                litterPickEvent.UpdatedByUserId = null;
            }
        }

        _db.Users.Remove(user);
        await _db.SaveChangesAsync();

        foreach (var litterPickEvent in litterPickEvents.Where(item => attendedEventIds.Contains(item.Id)))
        {
            litterPickEvent.RegisteredCount = await _db.LitterPickAttendances.CountAsync(item => item.LitterPickEventId == litterPickEvent.Id);
        }

        await _db.SaveChangesAsync();
        await transaction.CommitAsync();
        return true;
    }

    public async Task<AppUser?> UpdateAccountAsync(Guid id, UpdateAccountRequest request)
    {
        var user = await _db.Users
            .Include(item => item.UserRoles)
            .ThenInclude(item => item.Role)
            .SingleOrDefaultAsync(item => item.Id == id);
        if (user is null || user.IsDisabled)
        {
            return null;
        }

        user.DisplayName = Clean(request.DisplayName, 160);
        if (string.IsNullOrWhiteSpace(user.DisplayName))
        {
            user.DisplayName = user.Email;
        }

        if (request.ClearAvatar)
        {
            ClearAvatar(user);
        }
        else if (request.Avatar is not null)
        {
            ApplyAvatar(user, request.Avatar);
        }

        await _db.SaveChangesAsync();
        return user;
    }

    public async Task<bool> ChangePasswordAsync(Guid id, ChangePasswordRequest request)
    {
        ValidatePassword(request.NewPassword);
        var user = await _db.Users.SingleOrDefaultAsync(item => item.Id == id);
        if (user is null || user.IsDisabled)
        {
            return false;
        }

        var result = _passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.CurrentPassword);
        if (result == PasswordVerificationResult.Failed)
        {
            throw new InvalidOperationException("Current password is incorrect.");
        }

        user.PasswordHash = _passwordHasher.HashPassword(user, request.NewPassword);
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<bool> ResetPasswordAsync(Guid id, string password)
    {
        ValidatePassword(password);
        var user = await _db.Users.SingleOrDefaultAsync(item => item.Id == id);
        if (user is null)
        {
            return false;
        }

        user.PasswordHash = _passwordHasher.HashPassword(user, password);
        await _db.SaveChangesAsync();
        return true;
    }

    public static CurrentUserDto ToCurrentUser(ClaimsPrincipal user)
    {
        var idText = user.FindFirstValue(ClaimTypes.NameIdentifier) ?? Guid.Empty.ToString();
        var id = Guid.TryParse(idText, out var parsed) ? parsed : Guid.Empty;
        var email = user.FindFirstValue(ClaimTypes.Email) ?? string.Empty;
        var displayName = user.FindFirstValue(ClaimTypes.Name) ?? email;
        var roles = user.FindAll(ClaimTypes.Role).Select(claim => claim.Value).OrderBy(role => role).ToArray();
        return new CurrentUserDto(id, email, displayName, roles, null);
    }

    public static CurrentUserDto ToCurrentUser(AppUser user)
    {
        var roles = user.UserRoles.Select(userRole => userRole.Role.Name).OrderBy(role => role).ToArray();
        return new CurrentUserDto(user.Id, user.Email, user.DisplayName, roles, AvatarDataUrl(user));
    }

    public static UserDto ToUserDto(AppUser user)
    {
        var roles = user.UserRoles.Select(userRole => userRole.Role.Name).OrderBy(role => role).ToArray();
        return new UserDto(user.Id, user.Email, user.DisplayName, roles, user.IsDisabled, user.CreatedAt, user.LastLoginAt, AvatarDataUrl(user));
    }

    public static string NormalizeEmail(string value)
    {
        return Clean(value, 320).ToUpperInvariant();
    }

    public static string Clean(string? value, int maxLength)
    {
        return (value ?? string.Empty).Trim()[..Math.Min((value ?? string.Empty).Trim().Length, maxLength)];
    }

    private async Task ApplyRolesAsync(AppUser user, string[]? requestedRoles)
    {
        var names = (requestedRoles is { Length: > 0 } ? requestedRoles : new[] { AppRoles.User })
            .Select(role => Clean(role, 80))
            .Where(role => role == AppRoles.Admin || role == AppRoles.Editor || role == AppRoles.User)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (names.Length == 0)
        {
            names = new[] { AppRoles.User };
        }

        user.UserRoles.Clear();

        foreach (var roleName in names)
        {
            var role = await _db.Roles.SingleAsync(item => item.Name == roleName);
            user.UserRoles.Add(new AppUserRole
            {
                User = user,
                Role = role
            });
        }
    }

    private static void ValidatePassword(string password)
    {
        if (string.IsNullOrWhiteSpace(password) || password.Length < 10)
        {
            throw new InvalidOperationException("Passwords must be at least 10 characters long.");
        }
    }

    private static void ApplyAvatar(AppUser user, PhotoDto avatar)
    {
        var contentType = Clean(avatar.ContentType, 120).ToLowerInvariant();
        if (!contentType.StartsWith("image/", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Avatar must be an image.");
        }

        var data = DecodeDataUrl(avatar.DataUrl);
        if (data is null || data.Length == 0 || data.Length > 1_000_000)
        {
            throw new InvalidOperationException("Avatar image is too large.");
        }

        user.AvatarFileName = CleanOptional(avatar.FileName, 220) ?? "avatar";
        user.AvatarContentType = contentType;
        user.AvatarData = data;
    }

    private static void ClearAvatar(AppUser user)
    {
        user.AvatarFileName = null;
        user.AvatarContentType = null;
        user.AvatarData = null;
    }

    public static string? AvatarDataUrl(AppUser user)
    {
        if (user.AvatarData is null || user.AvatarData.Length == 0 || string.IsNullOrWhiteSpace(user.AvatarContentType))
        {
            return null;
        }

        return $"data:{user.AvatarContentType};base64,{Convert.ToBase64String(user.AvatarData)}";
    }

    private static byte[]? DecodeDataUrl(string dataUrl)
    {
        var commaIndex = dataUrl.IndexOf(',', StringComparison.Ordinal);
        var base64 = commaIndex >= 0 ? dataUrl[(commaIndex + 1)..] : dataUrl;
        try
        {
            return Convert.FromBase64String(base64);
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static string? CleanOptional(string? value, int maxLength)
    {
        var cleaned = Clean(value, maxLength);
        return string.IsNullOrWhiteSpace(cleaned) ? null : cleaned;
    }
}
