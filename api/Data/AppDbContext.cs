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
    public DbSet<LitterReportEntity> LitterReports => Set<LitterReportEntity>();
    public DbSet<LitterPickEventEntity> LitterPickEvents => Set<LitterPickEventEntity>();

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
            entity.HasIndex(item => item.SortOrder);
        });

        modelBuilder.Entity<LitterReportEntity>(entity =>
        {
            entity.ToTable("litter_reports");
            entity.HasKey(report => report.Id);
            entity.Property(report => report.Id).HasMaxLength(80);
            entity.Property(report => report.LocationLabel).HasMaxLength(120).IsRequired();
            entity.Property(report => report.Amount).HasMaxLength(40);
            entity.Property(report => report.Comment).HasMaxLength(1200);
            entity.Property(report => report.Contact).HasMaxLength(180);
            entity.Property(report => report.MapLink).HasMaxLength(500).IsRequired();
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
            entity.Property(item => item.MeetingPoint).HasMaxLength(220);
            entity.Property(item => item.Notes).HasColumnType("text");
            entity.Property(item => item.Status).HasMaxLength(24).IsRequired();
            entity.Property(item => item.AreasJson).HasColumnType("longtext").IsRequired();
            entity.HasIndex(item => item.Date);
            entity.HasIndex(item => item.Status);
        });
    }
}
