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
        await EnsureSchemaUpdatesAsync(db);
        await SeedRolesAsync(db);
        await SeedInitialAdminAsync(db, configuration, logger);
    }

    private static async Task EnsureSchemaUpdatesAsync(AppDbContext db)
    {
        await db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE `users`
            ADD COLUMN IF NOT EXISTS `AvatarFileName` varchar(220) CHARACTER SET utf8mb4 NULL;
            """);
        await db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE `users`
            ADD COLUMN IF NOT EXISTS `AvatarContentType` varchar(120) CHARACTER SET utf8mb4 NULL;
            """);
        await db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE `users`
            ADD COLUMN IF NOT EXISTS `AvatarData` longblob NULL;
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS `stored_photos` (
                `Id` varchar(80) CHARACTER SET utf8mb4 NOT NULL,
                `OwnerType` varchar(40) CHARACTER SET utf8mb4 NOT NULL,
                `OwnerId` varchar(80) CHARACTER SET utf8mb4 NOT NULL,
                `FileName` varchar(220) CHARACTER SET utf8mb4 NOT NULL,
                `ContentType` varchar(120) CHARACTER SET utf8mb4 NOT NULL,
                `Data` longblob NOT NULL,
                `CreatedAt` datetime(6) NOT NULL,
                CONSTRAINT `PK_stored_photos` PRIMARY KEY (`Id`)
            ) CHARACTER SET=utf8mb4;
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS `IX_stored_photos_OwnerType_OwnerId`
            ON `stored_photos` (`OwnerType`, `OwnerId`);
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS `IX_stored_photos_CreatedAt`
            ON `stored_photos` (`CreatedAt`);
            """);
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
