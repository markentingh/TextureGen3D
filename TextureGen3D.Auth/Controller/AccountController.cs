using TextureGen3D.Auth.Models;
using TextureGen3D.Auth.Services;
using TextureGen3D.Data.Interfaces.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace TextureGen3D.Auth.Controller
{
    [Route("api/auth")]
    [ApiController]
    public class AccountController : ControllerBase
    {
        readonly IAuthService _authService;
        readonly IAppUserRepository _userRepo;
        readonly AuthSettings _authSettings;

        public AccountController(
            IOptions<AuthSettings> authSettings,
            IAuthService authService,
            IAppUserRepository userRepo
        )
        {
            _authSettings = authSettings.Value;
            _authService = authService;
            _userRepo = userRepo;
        }

        private void SetAuthTokenCookie(string token)
        {
            if (string.IsNullOrWhiteSpace(token))
                return;

            var options = new CookieOptions
            {
                HttpOnly = true,
                Secure = Request.IsHttps,
                SameSite = SameSiteMode.Lax,
                Path = "/"
            };

            if (int.TryParse(_authSettings.JWT.ExpiryMins, out var expiryMinutes) && expiryMinutes > 0)
            {
                options.MaxAge = TimeSpan.FromMinutes(expiryMinutes);
            }

            Response.Cookies.Append("texturegen3d_token", token, options);
        }

        [HttpPost("login")]
        public async Task<IActionResult> Login([FromBody] LoginCredentials loginUser)
        {
            try
            {
                var result = await _authService.Authenticate(loginUser.Username, loginUser.Password, IPAddress);
                switch (result.ResponseCode)
                {
                    case AuthenticationResponseCode.LocalSuccess:
                        var refreshToken = await _authService.GenerateRefreshToken(IPAddress, result.UserId);
                        SetAuthTokenCookie(result.JwtToken);
                        return Ok(new
                        {
                            success = true,
                            data = new
                            {
                                appUserId = result.UserId,
                                displayName = result.DisplayName != "" ? result.DisplayName : result.Email.Split("@")[0],
                                token = result.JwtToken,
                                refreshToken = refreshToken.Token,
                                roles = result.Roles
                            }
                        });
                    case AuthenticationResponseCode.AccountLocked:
                        return Ok(new { success = false, message = "Your account has been locked. Too many invalid login attempts." });
                    default:
                        return Ok(new { success = false, message = "Invalid username and/or password." });
                }
            }
            catch (Exception ex)
            {
                return Ok(new { success = false, message = ex.Message });
            }
        }

        [HttpPost("refresh-token")]
        public async Task<IActionResult> RefreshToken([FromBody] RefreshToken refreshtoken)
        {
            try
            {
                var result = await _authService.RefreshUserToken(refreshtoken.Token, IPAddress);
                if (string.IsNullOrEmpty(result))
                {
                    return Ok(new { success = false, message = "RefreshToken is invalid" });
                }
                SetAuthTokenCookie(result);
                return Ok(new { success = true, data = new { token = result } });
            }
            catch (Exception ex)
            {
                return Ok(new { success = false, message = ex.Message });
            }
        }

        [HttpGet("check-auth")]
        [Authorize]
        public IActionResult CheckAuth()
        {
            return Ok(new { success = true });
        }

        [HttpPost("activate")]
        public async Task<IActionResult> ActivateAccount([FromBody] ActivateAccount activate)
        {
            var user = await _authService.ActivateAccount(activate.Hash);
            if (user == null)
            {
                return Ok(new { success = false, message = "Your account could not be activated." });
            }
            return Ok(new { success = true, data = new { hasPass = !string.IsNullOrEmpty(user.PasswordHash) } });
        }

        [HttpPost("check-password-reset")]
        public async Task<IActionResult> CheckPasswordReset([FromBody] ResetPassword passwordResetHash)
        {
            var hash = await _authService.CheckPasswordResetHash(passwordResetHash.Hash);
            if (!hash)
            {
                return Ok(new { success = false, message = "Your password has already been created." });
            }
            return Ok(new { success = true });
        }

        [HttpPost("update-password")]
        public async Task<IActionResult> UpdatePassword([FromBody] UpdatePassword passwordHash)
        {
            if (string.IsNullOrEmpty(passwordHash.Password)) passwordHash.Password = Guid.NewGuid().ToString();
            passwordHash.Password = new PasswordHasher<object>().HashPassword(new object(), passwordHash.Password);
            var hash = await _authService.ResetPassword(passwordHash.Password, passwordHash.Hash);
            if (string.IsNullOrEmpty(hash))
                return Ok(new { success = false, message = "The link has expired." });
            return Ok(new { success = true });
        }

        private string IPAddress
        {
            get
            {
                if (Request.Headers.ContainsKey("X-Forwarded-For"))
                    return Request.Headers["X-Forwarded-For"].ToString() ?? "unknown";
                return HttpContext.Connection.RemoteIpAddress?.MapToIPv4().ToString() ?? "unknown";
            }
        }
    }
}
