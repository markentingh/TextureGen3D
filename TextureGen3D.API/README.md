# TextureGen3D.API

ASP.NET Core API project containing the application's REST API controllers.

## Usage

- All public/user API controllers live in `Controllers/`.
- Admin API controllers live in `Controllers/Admin/`.
- All controllers inherit from `ApiController` in `Controllers/Base/ApiController.cs`.
- Return responses using `Json(new ApiResponse { ... })`.
- Use POST for endpoints that accept a model; use GET for endpoints with simple parameters.
- Wrap repository calls in try/catch and return `ApiResponse.message` only for error messages.

## Current APIs

- `/api/users` - User management (add, get, edit, delete, my-info).
- `/api/admin/users` - Admin user management (get-all, get-all-filtered, get-roles, update-lock).

## References

- References `TextureGen3D.Auth` for authentication services and policies.
- References `TextureGen3D.Data` for repositories and entities.
