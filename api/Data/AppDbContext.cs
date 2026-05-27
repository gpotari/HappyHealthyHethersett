using HappyHealthyHethersett.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace HappyHealthyHethersett.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<AppRole> Roles => Set<AppRole>();
    public DbSet<AppUserRole> UserRoles => Set<AppUserRole>();
    public DbSet<CommunityEvent> Events => Set<CommunityEvent>();
    public DbSet<EventAttendanceEntity> EventAttendances => Set<EventAttendanceEntity>();
    public DbSet<LitterReportEntity> LitterReports => Set<LitterReportEntity>();
    public DbSet<LitterPickEventEntity> LitterPickEvents => Set<LitterPickEventEntity>();
    public DbSet<LitterPickAttendanceEntity> LitterPickAttendances => Set<LitterPickAttendanceEntity>();
    public DbSet<LitterPickReminderDeliveryEntity> LitterPickReminderDeliveries => Set<LitterPickReminderDeliveryEntity>();
    public DbSet<PushNotificationSubscriptionEntity> PushNotificationSubscriptions => Set<PushNotificationSubscriptionEntity>();
    public DbSet<StoredPhotoEntity> StoredPhotos => Set<StoredPhotoEntity>();
    public DbSet<FeedbackMessageEntity> FeedbackMessages => Set<FeedbackMessageEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AppUser>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(user => user.Id);
            entity.Property(user => user.Email).HasMaxLength(320).IsRequired();
            entity.Property(user => user.NormalizedEmail).HasMaxLength(320).IsRequired();
            entity.Property(user => user.DisplayName).HasMaxLength(160).IsRequired();
            entity.Property(user => user.PasswordHash).HasColumnType("text").IsRequired();
            entity.Property(user => user.AvatarFileName).HasMaxLength(220);
            entity.Property(user => user.AvatarContentType).HasMaxLength(120);
            entity.Property(user => user.AvatarData).HasColumnType("longblob");
            entity.HasIndex(user => user.NormalizedEmail).IsUnique();
        });

        modelBuilder.Entity<AppRole>(entity =>
        {
            entity.ToTable("roles");
            entity.HasKey(role => role.Id);
            entity.Property(role => role.Name).HasMaxLength(80).IsRequired();
            entity.HasIndex(role => role.Name).IsUnique();
        });

        modelBuilder.Entity<AppUserRole>(entity =>
        {
            entity.ToTable("user_roles");
            entity.HasKey(userRole => new { userRole.UserId, userRole.RoleId });
            entity.HasOne(userRole => userRole.User)
                .WithMany(user => user.UserRoles)
                .HasForeignKey(userRole => userRole.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(userRole => userRole.Role)
                .WithMany(role => role.UserRoles)
                .HasForeignKey(userRole => userRole.RoleId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<CommunityEvent>(entity =>
        {
            entity.ToTable("events");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.PublicId).HasMaxLength(80).IsRequired();
            entity.Property(item => item.Title).HasMaxLength(220).IsRequired();
            entity.Property(item => item.Date).HasMaxLength(40).IsRequired();
            entity.Property(item => item.Start).HasMaxLength(40).IsRequired();
            entity.Property(item => item.End).HasMaxLength(40).IsRequired();
            entity.Property(item => item.Location).HasMaxLength(220);
            entity.Property(item => item.Description).HasColumnType("text").IsRequired();
            entity.Property(item => item.CtaLabel).HasMaxLength(120);
            entity.Property(item => item.CtaHref).HasMaxLength(1200);
            entity.Property(item => item.Note).HasMaxLength(500);
            entity.Property(item => item.Phone).HasMaxLength(80);
            entity.Property(item => item.ImageUrl).HasColumnType("longtext");
            entity.Property(item => item.ImageAlt).HasMaxLength(260);
            entity.Property(item => item.CreatedByUserId);
            entity.HasOne(item => item.CreatedByUser)
                .WithMany()
                .HasForeignKey(item => item.CreatedByUserId)
                .OnDelete(DeleteBehavior.SetNull);
            entity.Property(item => item.UpdatedByUserId);
            entity.HasOne(item => item.UpdatedByUser)
                .WithMany()
                .HasForeignKey(item => item.UpdatedByUserId)
                .OnDelete(DeleteBehavior.SetNull);
            entity.HasIndex(item => item.PublicId).IsUnique();
            entity.HasIndex(item => item.SortOrder);
            entity.HasIndex(item => item.CreatedAt);
            entity.HasIndex(item => item.CreatedByUserId);
            entity.HasIndex(item => item.UpdatedAt);
            entity.HasIndex(item => item.UpdatedByUserId);
        });

        modelBuilder.Entity<EventAttendanceEntity>(entity =>
        {
            entity.ToTable("event_attendances");
            entity.HasKey(item => new { item.EventId, item.UserId });
            entity.Property(item => item.EventId).HasMaxLength(80);
            entity.HasOne(item => item.User)
                .WithMany()
                .HasForeignKey(item => item.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(item => item.UserId);
            entity.HasIndex(item => item.CreatedAt);
        });

        modelBuilder.Entity<LitterReportEntity>(entity =>
        {
            entity.ToTable("litter_reports");
            entity.HasKey(report => report.Id);
            entity.Property(report => report.Id).HasMaxLength(80);
            entity.Property(report => report.State).HasMaxLength(24).IsRequired();
            entity.Property(report => report.LocationLabel).HasMaxLength(120).IsRequired();
            entity.Property(report => report.Amount).HasMaxLength(40);
            entity.Property(report => report.Comment).HasMaxLength(1200);
            entity.Property(report => report.Contact).HasMaxLength(180);
            entity.Property(report => report.MapLink).HasMaxLength(500).IsRequired();
            entity.HasIndex(report => report.State);
            entity.HasIndex(report => report.CreatedAt);
        });

        modelBuilder.Entity<LitterPickEventEntity>(entity =>
        {
            entity.ToTable("litter_pick_events");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasMaxLength(80);
            entity.Property(item => item.Title).HasMaxLength(220).IsRequired();
            entity.Property(item => item.Date).HasMaxLength(40).IsRequired();
            entity.Property(item => item.Start).HasMaxLength(40);
            entity.Property(item => item.End).HasMaxLength(40);
            entity.Property(item => item.Description).HasMaxLength(1400);
            entity.Property(item => item.MeetingPoint).HasMaxLength(220);
            entity.Property(item => item.WhatToBring).HasMaxLength(800);
            entity.Property(item => item.EquipmentProvided).HasMaxLength(800);
            entity.Property(item => item.Difficulty).HasMaxLength(40);
            entity.Property(item => item.AccessibilityNotes).HasMaxLength(1200);
            entity.Property(item => item.WeatherPlan).HasMaxLength(800);
            entity.Property(item => item.ContactName).HasMaxLength(160);
            entity.Property(item => item.ContactEmail).HasMaxLength(320);
            entity.Property(item => item.ContactPhone).HasMaxLength(80);
            entity.Property(item => item.Notes).HasColumnType("text");
            entity.Property(item => item.Status).HasMaxLength(24).IsRequired();
            entity.Property(item => item.AreasJson).HasColumnType("longtext").IsRequired();
            entity.Property(item => item.CreatedByUserId);
            entity.HasOne(item => item.CreatedByUser)
                .WithMany()
                .HasForeignKey(item => item.CreatedByUserId)
                .OnDelete(DeleteBehavior.SetNull);
            entity.Property(item => item.UpdatedByUserId);
            entity.HasOne(item => item.UpdatedByUser)
                .WithMany()
                .HasForeignKey(item => item.UpdatedByUserId)
                .OnDelete(DeleteBehavior.SetNull);
            entity.HasIndex(item => item.Date);
            entity.HasIndex(item => item.Status);
            entity.HasIndex(item => item.CreatedAt);
            entity.HasIndex(item => item.CreatedByUserId);
            entity.HasIndex(item => item.UpdatedAt);
            entity.HasIndex(item => item.UpdatedByUserId);
        });

        modelBuilder.Entity<LitterPickAttendanceEntity>(entity =>
        {
            entity.ToTable("litter_pick_attendances");
            entity.HasKey(item => new { item.LitterPickEventId, item.UserId });
            entity.Property(item => item.LitterPickEventId).HasMaxLength(80);
            entity.HasOne(item => item.LitterPickEvent)
                .WithMany()
                .HasForeignKey(item => item.LitterPickEventId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(item => item.User)
                .WithMany()
                .HasForeignKey(item => item.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(item => item.UserId);
            entity.HasIndex(item => item.CreatedAt);
        });

        modelBuilder.Entity<LitterPickReminderDeliveryEntity>(entity =>
        {
            entity.ToTable("litter_pick_reminder_deliveries");
            entity.HasKey(item => new { item.LitterPickEventId, item.UserId, item.ReminderType });
            entity.Property(item => item.LitterPickEventId).HasMaxLength(80);
            entity.Property(item => item.ReminderType).HasMaxLength(16);
            entity.HasIndex(item => item.SentAt);
        });

        modelBuilder.Entity<PushNotificationSubscriptionEntity>(entity =>
        {
            entity.ToTable("push_notification_subscriptions");
            entity.HasKey(item => item.Endpoint);
            entity.Property(item => item.Endpoint).HasColumnType("varchar(600)").IsRequired();
            entity.Property(item => item.P256dh).HasColumnType("varchar(256)").IsRequired();
            entity.Property(item => item.Auth).HasColumnType("varchar(128)").IsRequired();
            entity.Property(item => item.LastError).HasMaxLength(500);
            entity.HasOne(item => item.User)
                .WithMany()
                .HasForeignKey(item => item.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(item => item.UserId);
            entity.HasIndex(item => item.UpdatedAt);
        });

        modelBuilder.Entity<StoredPhotoEntity>(entity =>
        {
            entity.ToTable("stored_photos");
            entity.HasKey(photo => photo.Id);
            entity.Property(photo => photo.Id).HasMaxLength(80);
            entity.Property(photo => photo.OwnerType).HasMaxLength(40).IsRequired();
            entity.Property(photo => photo.OwnerId).HasMaxLength(80).IsRequired();
            entity.Property(photo => photo.FileName).HasMaxLength(220).IsRequired();
            entity.Property(photo => photo.ContentType).HasMaxLength(120).IsRequired();
            entity.Property(photo => photo.Data).HasColumnType("longblob").IsRequired();
            entity.HasIndex(photo => new { photo.OwnerType, photo.OwnerId });
            entity.HasIndex(photo => photo.CreatedAt);
        });

        modelBuilder.Entity<FeedbackMessageEntity>(entity =>
        {
            entity.ToTable("feedback_messages");
            entity.HasKey(message => message.Id);
            entity.Property(message => message.Id).HasMaxLength(80);
            entity.Property(message => message.Name).HasMaxLength(160).IsRequired();
            entity.Property(message => message.Email).HasMaxLength(320).IsRequired();
            entity.Property(message => message.Subject).HasMaxLength(160);
            entity.Property(message => message.Message).HasMaxLength(3000).IsRequired();
            entity.Property(message => message.IpAddress).HasMaxLength(80);
            entity.Property(message => message.UserAgent).HasMaxLength(500);
            entity.HasIndex(message => message.CreatedAt);
        });
    }
}
