using HappyHealthyHethersett.Api.Data;
using HappyHealthyHethersett.Api.Domain;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace HappyHealthyHethersett.Api.Services;

public static class DatabaseInitializer
{
    public static async Task InitializeAsync(IServiceProvider services)
    {
        using var scope = services.CreateScope();
        var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("DatabaseInitializer");
        var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        await db.Database.EnsureCreatedAsync();
        await SeedRolesAsync(db);
        await SeedInitialAdminAsync(db, configuration, logger);
    }

    private static async Task SeedRolesAsync(AppDbContext db)
    {
        foreach (var roleName in new[] { AppRoles.Admin, AppRoles.Editor })
        {
            if (!await db.Roles.AnyAsync(role => role.Name == roleName))
            {
                db.Roles.Add(new AppRole { Name = roleName });
            }
        }

        await db.SaveChangesAsync();
    }

    private static async Task SeedInitialAdminAsync(AppDbContext db, IConfiguration configuration, ILogger logger)
    {
        if (await db.Users.AnyAsync())
        {
            return;
        }

        var email = Environment.GetEnvironmentVariable("HHH_INITIAL_ADMIN_EMAIL")
            ?? configuration["InitialAdmin:Email"];
        var password = Environment.GetEnvironmentVariable("HHH_INITIAL_ADMIN_PASSWORD")
            ?? configuration["InitialAdmin:Password"];

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
        {
            logger.LogWarning("No users exist yet. Set HHH_INITIAL_ADMIN_EMAIL and HHH_INITIAL_ADMIN_PASSWORD before first run to seed an admin user.");
            return;
        }

        if (password.Length < 10)
        {
            logger.LogWarning("Initial admin password was ignored because it is shorter than 10 characters.");
            return;
        }

        var adminRole = await db.Roles.SingleAsync(role => role.Name == AppRoles.Admin);
        var user = new AppUser
        {
            Email = email.Trim(),
            NormalizedEmail = AuthService.NormalizeEmail(email),
            DisplayName = "Site admin"
        };
        user.PasswordHash = new PasswordHasher<AppUser>().HashPassword(user, password);
        user.UserRoles.Add(new AppUserRole
        {
            User = user,
            Role = adminRole
        });

        db.Users.Add(user);
        await db.SaveChangesAsync();
        logger.LogInformation("Seeded initial admin user {Email}.", user.Email);
    }
}
