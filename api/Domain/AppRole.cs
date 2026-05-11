namespace HappyHealthyHethersett.Api.Domain;

public class AppRole
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public List<AppUserRole> UserRoles { get; set; } = new();
}
