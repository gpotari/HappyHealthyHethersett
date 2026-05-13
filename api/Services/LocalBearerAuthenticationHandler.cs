using System.Security.Claims;
using System.Text.Encodings.Web;
using HappyHealthyHethersett.Api.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace HappyHealthyHethersett.Api.Services;

public class LocalBearerAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    private readonly AppDbContext _db;
    private readonly BearerTokenService _bearerTokenService;

    public LocalBearerAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder,
        AppDbContext db,
        BearerTokenService bearerTokenService)
        : base(options, logger, encoder)
    {
        _db = db;
        _bearerTokenService = bearerTokenService;
    }

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var authorization = Request.Headers.Authorization.ToString();
        if (string.IsNullOrWhiteSpace(authorization) ||
            !authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return AuthenticateResult.NoResult();
        }

        var token = authorization["Bearer ".Length..].Trim();
        var principal = _bearerTokenService.ValidateToken(token);
        if (principal is null)
        {
            return AuthenticateResult.Fail("Invalid bearer token.");
        }

        var idText = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(idText, out var userId))
        {
            return AuthenticateResult.Fail("Invalid bearer token subject.");
        }

        var user = await _db.Users
            .AsNoTracking()
            .Include(item => item.UserRoles)
            .ThenInclude(item => item.Role)
            .SingleOrDefaultAsync(item => item.Id == userId);
        if (user is null || user.IsDisabled)
        {
            return AuthenticateResult.Fail("User is no longer active.");
        }

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Email, user.Email),
            new(ClaimTypes.Name, user.DisplayName)
        };
        claims.AddRange(user.UserRoles.Select(userRole => new Claim(ClaimTypes.Role, userRole.Role.Name)));

        var identity = new ClaimsIdentity(claims, BearerTokenService.AuthenticationScheme);
        var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), BearerTokenService.AuthenticationScheme);
        return AuthenticateResult.Success(ticket);
    }
}
