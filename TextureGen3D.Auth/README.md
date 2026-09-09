# TextureGen3D.Auth

Authentication and authorization library for the TextureGen3D stack.

## Usage

- `Services/AuthService.cs` - Core authentication logic, JWT generation, refresh tokens, password reset.
- `Services/SetupAuthService.cs` - Extension method to register authentication and policies with the web host.
- `Services/SetupPolicies.cs` - Authorization policy definitions.
- `Controller/AccountController.cs` - Account API endpoints (`login`, `refresh-token`, `check-auth`, etc.).
- `Models/` - Authentication models (AuthSettings, LoginCredentials, RefreshToken, etc.).
- `Policies/AuthConstants.cs` - Role and policy constants.

## References

- References `TextureGen3D.Data` for user and role repositories.
