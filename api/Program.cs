using HappyHealthyHethersett.Api;
using HappyHealthyHethersett.Api.Data;
using HappyHealthyHethersett.Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Microsoft.OpenApi.Models;
using Pomelo.EntityFrameworkCore.MySql.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException("Missing DefaultConnection connection string.");

builder.Services.AddDbContext<AppDbContext>(options =>
{
    options.UseMySql(connectionString, CreateServerVersion(builder.Configuration));
});

builder.Services.AddScoped<AuthService>();
builder.Services.AddSingleton<BearerTokenService>();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "Happy Healthy Hethersett API",
        Version = "v1",
        Description = "Local API for events, litter reports, litter-pick events and admin users."
    });
    options.AddSecurityDefinition("CookieAuth", new OpenApiSecurityScheme
    {
        Type = SecuritySchemeType.ApiKey,
        In = ParameterLocation.Cookie,
        Name = "hhh-admin",
        Description = "Sign in with /api/auth/login first. Swagger will then send the hhh-admin cookie with protected requests."
    });
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "Signed token",
        Description = "Use the token returned by /api/auth/login as an Authorization: Bearer token."
    });
    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = "CookieAuth"
                }
            },
            Array.Empty<string>()
        },
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });
});

var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();
if (allowedOrigins.Length > 0)
{
    builder.Services.AddCors(options =>
    {
        options.AddPolicy("App", policy =>
        {
            policy.WithOrigins(allowedOrigins)
                .AllowAnyHeader()
                .AllowAnyMethod()
                .AllowCredentials();
        });
    });
}

builder.Services.AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme = "BearerOrCookie";
        options.DefaultChallengeScheme = "BearerOrCookie";
        options.DefaultSignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
    })
    .AddPolicyScheme("BearerOrCookie", "Bearer or cookie", options =>
    {
        options.ForwardDefaultSelector = context =>
        {
            var authorization = context.Request.Headers.Authorization.ToString();
            return authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
                ? BearerTokenService.AuthenticationScheme
                : CookieAuthenticationDefaults.AuthenticationScheme;
        };
    })
    .AddScheme<AuthenticationSchemeOptions, LocalBearerAuthenticationHandler>(
        BearerTokenService.AuthenticationScheme,
        _ => { })
    .AddCookie(options =>
    {
        options.Cookie.Name = "hhh-admin";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.SlidingExpiration = true;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy(AppRoles.AdminOnlyPolicy, policy => policy.RequireRole(AppRoles.Admin));
    options.AddPolicy(AppRoles.StaffOnlyPolicy, policy => policy.RequireRole(AppRoles.Admin, AppRoles.Editor));
});

var app = builder.Build();

if (allowedOrigins.Length > 0)
{
    app.UseCors("App");
}

app.UseSwagger();
app.UseSwaggerUI(options =>
{
    options.SwaggerEndpoint("/swagger/v1/swagger.json", "Happy Healthy Hethersett API v1");
    options.RoutePrefix = "swagger";
});

app.UseAuthentication();
app.UseAuthorization();

await DatabaseInitializer.InitializeAsync(app.Services);

app.MapApiRoutes();

app.Run();

static ServerVersion CreateServerVersion(IConfiguration configuration)
{
    var configured = configuration["Database:ServerVersion"] ?? "MariaDb:10.6.0";
    var parts = configured.Split(':', 2, StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
    var serverType = parts.Length == 2 ? parts[0] : "MariaDb";
    var versionText = parts.Length == 2 ? parts[1] : parts[0];
    var version = Version.Parse(versionText);

    return serverType.Equals("MySql", StringComparison.OrdinalIgnoreCase)
        ? new MySqlServerVersion(version)
        : new MariaDbServerVersion(version);
}
