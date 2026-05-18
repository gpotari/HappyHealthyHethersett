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
        await db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE `events`
            ADD COLUMN IF NOT EXISTS `PublicId` varchar(80) CHARACTER SET utf8mb4 NULL;
            """);
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE `events`
            SET `PublicId` = CONCAT('event-', `Id`)
            WHERE `PublicId` IS NULL OR `PublicId` = '';
            """);
        await db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE `events`
            MODIFY COLUMN `PublicId` varchar(80) CHARACTER SET utf8mb4 NOT NULL;
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE UNIQUE INDEX IF NOT EXISTS `IX_events_PublicId`
            ON `events` (`PublicId`);
            """);
        await db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE `litter_pick_events`
            ADD COLUMN IF NOT EXISTS `Description` varchar(1400) CHARACTER SET utf8mb4 NULL,
            ADD COLUMN IF NOT EXISTS `Capacity` int NULL,
            ADD COLUMN IF NOT EXISTS `RegisteredCount` int NULL,
            ADD COLUMN IF NOT EXISTS `WhatToBring` varchar(800) CHARACTER SET utf8mb4 NULL,
            ADD COLUMN IF NOT EXISTS `EquipmentProvided` varchar(800) CHARACTER SET utf8mb4 NULL,
            ADD COLUMN IF NOT EXISTS `Difficulty` varchar(40) CHARACTER SET utf8mb4 NULL,
            ADD COLUMN IF NOT EXISTS `FamilyFriendly` tinyint(1) NULL,
            ADD COLUMN IF NOT EXISTS `AccessibilityNotes` varchar(1200) CHARACTER SET utf8mb4 NULL,
            ADD COLUMN IF NOT EXISTS `WeatherPlan` varchar(800) CHARACTER SET utf8mb4 NULL,
            ADD COLUMN IF NOT EXISTS `ContactName` varchar(160) CHARACTER SET utf8mb4 NULL,
            ADD COLUMN IF NOT EXISTS `ContactEmail` varchar(320) CHARACTER SET utf8mb4 NULL,
            ADD COLUMN IF NOT EXISTS `ContactPhone` varchar(80) CHARACTER SET utf8mb4 NULL,
            ADD COLUMN IF NOT EXISTS `BagsGoal` int NULL,
            ADD COLUMN IF NOT EXISTS `VolunteersGoal` int NULL;
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS `feedback_messages` (
                `Id` varchar(80) CHARACTER SET utf8mb4 NOT NULL,
                `CreatedAt` datetime(6) NOT NULL,
                `Name` varchar(160) CHARACTER SET utf8mb4 NOT NULL,
                `Email` varchar(320) CHARACTER SET utf8mb4 NOT NULL,
                `Subject` varchar(160) CHARACTER SET utf8mb4 NULL,
                `Message` varchar(3000) CHARACTER SET utf8mb4 NOT NULL,
                `IpAddress` varchar(80) CHARACTER SET utf8mb4 NULL,
                `UserAgent` varchar(500) CHARACTER SET utf8mb4 NULL,
                CONSTRAINT `PK_feedback_messages` PRIMARY KEY (`Id`)
            ) CHARACTER SET=utf8mb4;
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS `IX_feedback_messages_CreatedAt`
            ON `feedback_messages` (`CreatedAt`);
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
