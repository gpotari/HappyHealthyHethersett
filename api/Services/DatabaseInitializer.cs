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
            ALTER TABLE `events`
            ADD COLUMN IF NOT EXISTS `CreatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            ADD COLUMN IF NOT EXISTS `CreatedByUserId` char(36) CHARACTER SET ascii NULL,
            ADD COLUMN IF NOT EXISTS `UpdatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            ADD COLUMN IF NOT EXISTS `UpdatedByUserId` char(36) CHARACTER SET ascii NULL;
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS `IX_events_CreatedAt`
            ON `events` (`CreatedAt`);
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS `IX_events_CreatedByUserId`
            ON `events` (`CreatedByUserId`);
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS `IX_events_UpdatedAt`
            ON `events` (`UpdatedAt`);
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS `IX_events_UpdatedByUserId`
            ON `events` (`UpdatedByUserId`);
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS `event_attendances` (
                `EventId` varchar(80) CHARACTER SET utf8mb4 NOT NULL,
                `UserId` char(36) CHARACTER SET ascii NOT NULL,
                `CreatedAt` datetime(6) NOT NULL,
                CONSTRAINT `PK_event_attendances` PRIMARY KEY (`EventId`, `UserId`)
            ) CHARACTER SET=utf8mb4;
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS `IX_event_attendances_UserId`
            ON `event_attendances` (`UserId`);
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS `IX_event_attendances_CreatedAt`
            ON `event_attendances` (`CreatedAt`);
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
            ADD COLUMN IF NOT EXISTS `VolunteersGoal` int NULL,
            ADD COLUMN IF NOT EXISTS `CreatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            ADD COLUMN IF NOT EXISTS `UpdatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            ADD COLUMN IF NOT EXISTS `CreatedByUserId` char(36) CHARACTER SET ascii NULL,
            ADD COLUMN IF NOT EXISTS `UpdatedByUserId` char(36) CHARACTER SET ascii NULL;
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS `IX_litter_pick_events_CreatedAt`
            ON `litter_pick_events` (`CreatedAt`);
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS `IX_litter_pick_events_CreatedByUserId`
            ON `litter_pick_events` (`CreatedByUserId`);
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS `IX_litter_pick_events_UpdatedAt`
            ON `litter_pick_events` (`UpdatedAt`);
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS `IX_litter_pick_events_UpdatedByUserId`
            ON `litter_pick_events` (`UpdatedByUserId`);
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS `litter_pick_attendances` (
                `LitterPickEventId` varchar(80) CHARACTER SET utf8mb4 NOT NULL,
                `UserId` char(36) CHARACTER SET ascii NOT NULL,
                `CreatedAt` datetime(6) NOT NULL,
                CONSTRAINT `PK_litter_pick_attendances` PRIMARY KEY (`LitterPickEventId`, `UserId`)
            ) CHARACTER SET=utf8mb4;
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS `IX_litter_pick_attendances_UserId`
            ON `litter_pick_attendances` (`UserId`);
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS `IX_litter_pick_attendances_CreatedAt`
            ON `litter_pick_attendances` (`CreatedAt`);
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS `litter_pick_reminder_deliveries` (
                `LitterPickEventId` varchar(80) CHARACTER SET utf8mb4 NOT NULL,
                `UserId` char(36) CHARACTER SET ascii NOT NULL,
                `ReminderType` varchar(16) CHARACTER SET utf8mb4 NOT NULL,
                `SentAt` datetime(6) NOT NULL,
                CONSTRAINT `PK_litter_pick_reminder_deliveries` PRIMARY KEY (`LitterPickEventId`, `UserId`, `ReminderType`)
            ) CHARACTER SET=utf8mb4;
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS `IX_litter_pick_reminder_deliveries_SentAt`
            ON `litter_pick_reminder_deliveries` (`SentAt`);
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS `push_notification_subscriptions` (
                `Endpoint` varchar(600) CHARACTER SET utf8mb4 NOT NULL,
                `UserId` char(36) CHARACTER SET ascii NOT NULL,
                `P256dh` varchar(256) CHARACTER SET utf8mb4 NOT NULL,
                `Auth` varchar(128) CHARACTER SET utf8mb4 NOT NULL,
                `ExpiresAt` datetime(6) NULL,
                `CreatedAt` datetime(6) NOT NULL,
                `UpdatedAt` datetime(6) NOT NULL,
                `LastErrorAt` datetime(6) NULL,
                `LastError` varchar(500) CHARACTER SET utf8mb4 NULL,
                CONSTRAINT `PK_push_notification_subscriptions` PRIMARY KEY (`Endpoint`)
            ) CHARACTER SET=utf8mb4;
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS `IX_push_notification_subscriptions_UserId`
            ON `push_notification_subscriptions` (`UserId`);
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS `IX_push_notification_subscriptions_UpdatedAt`
            ON `push_notification_subscriptions` (`UpdatedAt`);
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
        await db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE `litter_reports`
            ADD COLUMN IF NOT EXISTS `State` varchar(24) CHARACTER SET utf8mb4 NOT NULL DEFAULT 'new';
            """);
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE `litter_reports`
            SET `State` = 'new'
            WHERE `State` IS NULL OR `State` = '';
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS `IX_litter_reports_State`
            ON `litter_reports` (`State`);
            """);
    }

    private static async Task SeedRolesAsync(AppDbContext db)
    {
        foreach (var roleName in new[] { AppRoles.Admin, AppRoles.Editor, AppRoles.User })
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
