# TextureGen3D.Data

Data access layer using Dapper and Npgsql for PostgreSQL.

## Usage

- `Entities/` - Data models mapped to database tables.
- `Interfaces/` - Repository interfaces.
- `Repositories/` - Dapper repository implementations.
- `Services/DapperStartupService.cs` - Registers `IDbConnection` and repositories as transient services.

## Adding a New Repository

1. Create the entity in `Entities/`.
2. Create the interface in `Interfaces/`.
3. Create the repository in `Repositories/`.
4. Register the interface and implementation in `Services/DapperStartupService.cs`.

## Current Repositories

- `IAppUserRepository` / `AppUserRepository`
- `IAppRoleRepository` / `AppRoleRepository`
- `IAppUserRolesRepository` / `AppUserRolesRepository`
- `IAppUserTokenRepository` / `AppUserTokenRepository`

## References

- Uses `Dapper` and `Npgsql`.
- Uses `Microsoft.Extensions.Configuration` and `Microsoft.Extensions.DependencyInjection`.
