# TextureGen3D.Web.Server

ASP.NET Core web host project for the TextureGen3D template.

## Usage

- `Program.cs` - Application startup, service registration, middleware pipeline, and controller/SPA fallback mapping.
- `appsettings.json` - Connection strings, authentication settings, and JWT configuration.
- `Properties/launchSettings.json` - Launch profile for Visual Studio.

## Startup Flow

1. Registers CORS, HTTP context, health checks, and controllers from `TextureGen3D.API` and `TextureGen3D.Auth` assemblies.
2. Calls `builder.AddApiStartupService()` to register Dapper and repositories.
3. Calls `builder.AddAuthService()` to register JWT/cookie authentication and policies.
4. Configures Swagger in development.
5. Resets PostgreSQL sequences on startup.
6. Maps controllers and SPA fallback to `index.html`.

## Development

In Development, `Microsoft.AspNetCore.SpaProxy` launches the Vite dev server from `TextureGen3D.Web.Client` (`npm run dev`) and proxies requests to it. The React app is available at the server URLs above; the Vite dev server runs on `https://localhost:7783`.

## Running the Server

```bash
dotnet run --project TextureGen3D.Web.Server --launch-profile https
```

Default URLs:
- HTTP: `http://0.0.0.0:7780`
- HTTPS: `https://0.0.0.0:7781`
- Swagger: `/swagger`

## References

- References `TextureGen3D.API`, `TextureGen3D.Auth`, `TextureGen3D.Data`, and `TextureGen3D.Web.Client`.
