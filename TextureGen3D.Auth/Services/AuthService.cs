using TextureGen3D.Auth.Models;
using TextureGen3D.Data.Entities.Auth;
using TextureGen3D.Data.Interfaces.Auth;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;

namespace TextureGen3D.Auth.Services
{
    public interface IAuthService
    {
        Task<AuthenticationResponse> Authenticate(string userName, string password, string userIP);
        Task<AppUserTokens> GenerateRefreshToken(string userIP, Guid? appUserId = null);
        Task<string> RefreshUserToken(string token, string userIP);
        Task<AppUser?> ActivateAccount(string hash);
        Task<string> GenerateResetPasswordHash(string emailAddress, int hours = 1);
        void GenerateResetPasswordHash(AppUser user, int hours = 1);
        Task<bool> CheckPasswordResetHash(string hashPassword);
        Task<string> ResetPassword(string newPasswordHash, string resetHash);
        AuthSettings Settings();
    }

    public class AuthService : IAuthService
    {
        readonly IAppUserRepository _userRepo;
        readonly IAppRoleRepository _roleRepo;
        readonly IAppUserTokenRepository _tokenRepo;
        public AuthSettings _authSettings;

        public AuthService(
            IOptions<AuthSettings> authSettings,
            IAppUserRepository userRepo,
            IAppRoleRepository roleRepo,
            IAppUserTokenRepository tokenRepo
        )
        {
            _authSettings = authSettings.Value;
            _userRepo = userRepo;
            _roleRepo = roleRepo;
            _tokenRepo = tokenRepo;
        }

        protected string GenerateToken(ClaimsIdentity identity)
        {
            SecurityTokenDescriptor descriptor = new SecurityTokenDescriptor
            {
                Issuer = _authSettings.JWT.ValidIssuer,
                Audience = _authSettings.JWT.ValidAudience,
                Subject = identity,
                Expires = DateTime.UtcNow.AddMinutes(int.Parse(_authSettings.JWT.ExpiryMins)),
                SigningCredentials = new SigningCredentials(
                    new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_authSettings.JWT.Secret)),
                    SecurityAlgorithms.HmacSha256Signature)
            };
            JwtSecurityTokenHandler handler = new JwtSecurityTokenHandler();
            SecurityToken secToken = handler.CreateToken(descriptor);
            return handler.WriteToken(secToken);
        }

        public async Task<AuthenticationResponse> Authenticate(string userName, string password, string userIP)
        {
            var user = await _userRepo.FindByUserEmailAsync(userName);
            if (user == null || user.EmailConfirmed == false) return new AuthenticationResponse { ResponseCode = AuthenticationResponseCode.Unauthorized };
            if (user.AccessFailedCount > 5) return new AuthenticationResponse { ResponseCode = AuthenticationResponseCode.AccountLocked };

            var loginResult = new PasswordHasher<object>().VerifyHashedPassword(new object(), user.PasswordHash ?? string.Empty, password);
            if (loginResult == PasswordVerificationResult.Success)
            {
                var response = new AuthenticationResponse { ResponseCode = AuthenticationResponseCode.LocalSuccess, UserId = user.Id, DisplayName = user.FullName, Email = user.Email };
                string token = await GenerateLocalUserLogin(user, response);
                response.JwtToken = token;
                return response;
            }

            return new AuthenticationResponse { ResponseCode = AuthenticationResponseCode.Unauthorized };
        }

        private async Task<string> GenerateLocalUserLogin(AppUser user, AuthenticationResponse? response = null)
        {
            var claims = new List<Claim>
            {
                new Claim(ClaimTypes.Name, user.Email ?? string.Empty),
                new Claim(ClaimTypes.Email, user.Email ?? string.Empty),
                new Claim("LastUpdated", DateTime.UtcNow.ToString()),
                new Claim("AppUser", user.Id?.ToString() ?? Guid.Empty.ToString()),
            };

            var roles = new List<string>();
            foreach (var role in user.UserRoles)
            {
                claims.Add(new Claim(ClaimTypes.Role, role.AppRole.Name));
                roles.Add(role.AppRole.Name);
            }

            if (response != null)
            {
                response.Claims = claims;
                response.Roles = roles;
            }

            ClaimsIdentity userIdentity = new ClaimsIdentity(claims, "login");
            return GenerateToken(userIdentity);
        }

        public async Task<AppUserTokens> GenerateRefreshToken(string userIP, Guid? appUserId = null)
        {
            var token = new AppUserTokens
            {
                Token = await GetUniqueToken(),
                AppUserId = appUserId,
                Expiry = DateTime.UtcNow.AddMinutes(int.Parse(_authSettings.JWT.RefreshExpiryMins)),
                Created = DateTime.UtcNow,
                IPAddress = userIP
            };
            if (!await _tokenRepo.IsTokenUnique(token.Token)) return await GenerateRefreshToken(userIP);

            await _tokenRepo.Add(token);
            return token;
        }

        public async Task<string> RefreshUserToken(string token, string userIP)
        {
            var refreshToken = await _tokenRepo.FindByTokenIP(token, userIP);
            if (refreshToken != null && refreshToken.IsActive)
            {
                if (_authSettings.JWT.UseRollingRefreshTokens)
                {
                    refreshToken.Expiry = DateTime.UtcNow.AddMinutes(int.Parse(_authSettings.JWT.RefreshExpiryMins));
                    await _tokenRepo.ExtendRefreshToken(refreshToken);
                }

                if (refreshToken.AppUserId.HasValue)
                {
                    var user = await _userRepo.FindByGuidAsync(refreshToken.AppUserId.Value);
                    return await GenerateLocalUserLogin(user);
                }
            }
            return "";
        }

        private async Task<string> GetUniqueToken()
        {
            var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));
            if (await _tokenRepo.IsTokenUnique(token)) return token;
            return await GetUniqueToken();
        }

        public async Task<AppUser?> ActivateAccount(string hash)
        {
            var user = await _userRepo.FindByPasswordResetHashAsync(hash);
            if (user != null)
            {
                await _userRepo.ActivateAccount(user);
            }
            return user;
        }

        public async Task<string> GenerateResetPasswordHash(string emailAddress, int hours = 1)
        {
            var hash = Guid.NewGuid().ToString("N");
            var user = await _userRepo.FindByUserEmailAsync(emailAddress);
            if (user != null)
            {
                user.PasswordResetTime = DateTime.UtcNow.AddHours(hours);
                user.PasswordResetHash = hash;
                await _userRepo.UpdatePasswordResetHash(user);
            }
            return hash;
        }

        public void GenerateResetPasswordHash(AppUser user, int hours = 1)
        {
            var hash = Guid.NewGuid().ToString("N");
            if (user != null)
            {
                user.PasswordResetTime = DateTime.UtcNow.AddHours(hours);
                user.PasswordResetHash = hash;
            }
        }

        public async Task<bool> CheckPasswordResetHash(string hash)
        {
            var user = await _userRepo.FindByPasswordResetHashAsync(hash);
            if ((user != null && !user.EmailConfirmed) ||
                (user != null && user.EmailConfirmed && user.PasswordResetTime != null && user.PasswordResetTime.Value >= DateTime.UtcNow))
            {
                return true;
            }
            return false;
        }

        public async Task<string> ResetPassword(string newPasswordHash, string resetHash)
        {
            var user = await _userRepo.FindByPasswordResetHashAsync(resetHash);
            if (user != null)
            {
                if (!user.EmailConfirmed && user.PasswordResetHash != null && user.PasswordResetTime != null)
                {
                    user.PasswordResetTime = null;
                    user.PasswordResetHash = string.Empty;
                    user.PasswordHash = newPasswordHash;
                    await _userRepo.UpdatePasswordHash(user);
                }
                else if (user.EmailConfirmed && user.PasswordResetHash != null && user.PasswordResetTime != null && user.PasswordResetTime.Value >= DateTime.UtcNow)
                {
                    user.PasswordResetTime = null;
                    user.PasswordResetHash = string.Empty;
                    user.PasswordHash = newPasswordHash;
                    await _userRepo.UpdatePasswordHash(user);
                }
                else
                {
                    return string.Empty;
                }
            }
            return user == null ? string.Empty : newPasswordHash;
        }

        public AuthSettings Settings()
        {
            return _authSettings;
        }
    }

    public class AuthenticationResponse
    {
        public AuthenticationResponseCode ResponseCode { get; set; }
        public Guid? UserId { get; set; }
        public string DisplayName { get; set; } = "";
        public string Email { get; set; } = "";
        public string JwtToken { get; set; } = "";
        public List<Claim> Claims { get; set; } = new List<Claim>();
        public List<string> Roles { get; set; } = new List<string>();
    }

    public enum AuthenticationResponseCode
    {
        LocalSuccess,
        Unauthorized,
        AccountLocked
    }
}
