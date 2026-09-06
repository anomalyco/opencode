---
name: dotnet-core-expert
description: Use when building .NET 8 applications with minimal APIs, clean architecture, or cloud-native microservices. Invoke for Entity Framework Core, CQRS with MediatR, JWT authentication, AOT compilation.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: backend
  triggers: .NET Core, .NET 8, ASP.NET Core, C# 12, minimal API, Entity Framework Core, microservices .NET, CQRS, MediatR
  role: specialist
  scope: implementation
  output-format: code
  related-skills: fullstack-guardian, microservices-architect, cloud-architect, test-master
---

# .NET Core Expert

## Core Workflow

1. **Analyze requirements** — Identify architecture pattern, data models, API design
2. **Design solution** — Create clean architecture layers with proper separation
3. **Implement** — Write high-performance code with modern C# features; run `dotnet build` to verify compilation — if build fails, review errors, fix issues, and rebuild before proceeding
4. **Secure** — Add authentication, authorization, and security best practices
5. **Test** — Write comprehensive tests with xUnit and integration testing; run `dotnet test` to confirm all tests pass — if tests fail, diagnose failures, fix the implementation, and re-run before continuing; verify endpoints with `curl` or a REST client

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Minimal APIs | `references/minimal-apis.md` | Creating endpoints, routing, middleware |
| Clean Architecture | `references/clean-architecture.md` | CQRS, MediatR, layers, DI patterns |
| Entity Framework | `references/entity-framework.md` | DbContext, migrations, relationships |
| Authentication | `references/authentication.md` | JWT, Identity, authorization policies |
| Cloud-Native | `references/cloud-native.md` | Docker, health checks, configuration |

## Constraints

### MUST DO
- Use .NET 8 and C# 12 features
- Enable nullable reference types: `<Nullable>enable</Nullable>` in the `.csproj`
- Use async/await for all I/O operations — e.g., `await dbContext.Users.ToListAsync()`
- Implement proper dependency injection
- Use record types for DTOs — e.g., `public record UserDto(int Id, string Name);`
- Follow clean architecture principles
- Write integration tests with `WebApplicationFactory<Program>`
- Configure OpenAPI/Swagger documentation

### MUST NOT DO
- Use synchronous I/O operations
- Expose entities directly in API responses
- Skip input validation
- Use legacy .NET Framework patterns
- Mix concerns across architectural layers
- Use deprecated EF Core patterns

## Code Examples

### Minimal API Endpoint
```csharp
// Program.cs
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddMediatR(cfg => cfg.RegisterServicesFromAssembly(typeof(Program).Assembly));

var app = builder.Build();
app.UseSwagger();
app.UseSwaggerUI();

app.MapGet("/users/{id}", async (int id, ISender sender, CancellationToken ct) =>
{
    var result = await sender.Send(new GetUserQuery(id), ct);
    return result is null ? Results.NotFound() : Results.Ok(result);
})
.WithName("GetUser")
.Produces<UserDto>()
.ProducesProblem(404);

app.Run();
```

### MediatR Query Handler
```csharp
// Application/Users/GetUserQuery.cs
public record GetUserQuery(int Id) : IRequest<UserDto?>;

public sealed class GetUserQueryHandler : IRequestHandler<GetUserQuery, UserDto?>
{
    private readonly AppDbContext _db;

    public GetUserQueryHandler(AppDbContext db) => _db = db;

    public async Task<UserDto?> Handle(GetUserQuery request, CancellationToken ct) =>
        await _db.Users
            .AsNoTracking()
            .Where(u => u.Id == request.Id)
            .Select(u => new UserDto(u.Id, u.Name))
            .FirstOrDefaultAsync(ct);
}
```

### EF Core DbContext with Async Query
```csharp
// Infrastructure/AppDbContext.cs
public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
    }
}

// Usage in a service
public async Task<IReadOnlyList<UserDto>> GetAllAsync(CancellationToken ct) =>
    await _db.Users
        .AsNoTracking()
        .Select(u => new UserDto(u.Id, u.Name))
        .ToListAsync(ct);
```

### DTO with Record Type
```csharp
public record UserDto(int Id, string Name);
public record CreateUserRequest(string Name, string Email);
```

## Output Templates

When implementing .NET features, provide:
1. Project structure (solution/project files)
2. Domain models and DTOs
3. API endpoints or service implementations
4. Database context and migrations if applicable
5. Brief explanation of architectural decisions

[Documentation](https://jeffallan.github.io/claude-skills/skills/backend/dotnet-core-expert/)
