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

    public async Task<AppUser> RegisterPendingUserAsync(RegisterRequest request)
    {
        return await CreateUserAsync(request.Email, request.DisplayName, request.Password, new[] { AppRoles.Editor }, true);
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
        return new CurrentUserDto(id, email, displayName, roles);
    }

    public static UserDto ToUserDto(AppUser user)
    {
        var roles = user.UserRoles.Select(userRole => userRole.Role.Name).OrderBy(role => role).ToArray();
        return new UserDto(user.Id, user.Email, user.DisplayName, roles, user.IsDisabled, user.CreatedAt, user.LastLoginAt);
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
        var names = (requestedRoles is { Length: > 0 } ? requestedRoles : new[] { AppRoles.Editor })
            .Select(role => Clean(role, 80))
            .Where(role => role == AppRoles.Admin || role == AppRoles.Editor)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (names.Length == 0)
        {
            names = new[] { AppRoles.Editor };
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
}
