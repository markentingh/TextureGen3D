using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using TextureGen3D.API.Models;
using TextureGen3D.API.Services;
using TextureGen3D.Auth.Services;
using TextureGen3D.Auth.Policies;
using TextureGen3D.Data.Entities.Auth;
using TextureGen3D.Data.Interfaces.Auth;

namespace TextureGen3D.API.Controllers
{
    [Route("/api/users")]
    public class UsersController : ApiController
    {
        readonly IAuthService _authService;
        readonly IAppUserRepository _userRepository;
        readonly IAppRoleRepository _roleRepository;
        readonly IEmailService _emailService;

        public UsersController(
            IAuthService authService,
            IAppUserRepository userRepository,
            IAppRoleRepository roleRepository,
            IEmailService emailService
        )
        {
            _authService = authService;
            _userRepository = userRepository;
            _roleRepository = roleRepository;
            _emailService = emailService;
        }

        [HttpPost("add")]
        [Authorize(Policy = nameof(AuthConstants.Policy.ManageUsers))]
        public async Task<IActionResult> AddUser([FromBody] NewUser user)
        {
            if (string.IsNullOrEmpty(user.Email)) return BadRequest("Email is required.");
            var emailRegex = new Regex("^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,10}$");
            if (!emailRegex.IsMatch(user.Email)) return BadRequest("Email is invalid.");
            if (string.IsNullOrEmpty(user.Password)) user.Password = Guid.NewGuid().ToString();

            try
            {
                var userExists = await _userRepository.FindByUserEmailAsync(user.Email);
                if (userExists != null && userExists.Email == user.Email)
                {
                    return Json(new ApiResponse { success = false, message = "An account with this email address already exists" });
                }
                AppUser newUser = new AppUser();
                newUser.Email = user.Email;
                newUser.FullName = user.FullName;
                newUser.Status = AppUserStatus.Active;
                newUser.EmailConfirmed = false;
                _authService.GenerateResetPasswordHash(newUser, 24);
                newUser.PasswordHash = new PasswordHasher<object>().HashPassword(new object(), user.Password);

                if (user.IsAdmin)
                {
                    var adminRoles = await _roleRepository.GetAll();
                    newUser.UserRoles = adminRoles.Where(a => a.Name == "admin").Select(a => new AppUserRole() { AppRoleId = a.Id }).ToList();
                }

                newUser = await _userRepository.Add(newUser);
                return Json(new ApiResponse { success = true, data = newUser });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("forgot-password")]
        [AllowAnonymous]
        public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordRequest request)
        {
            if (string.IsNullOrEmpty(request.Email))
            {
                return Json(new ApiResponse { success = false, message = "Email is required." });
            }

            try
            {
                var existingUser = await _userRepository.FindByUserEmailAsync(request.Email, false);
                if (existingUser != null)
                {
                    var hash = await _authService.GenerateResetPasswordHash(request.Email, 24);
                    existingUser.PasswordResetHash = hash;
                    _emailService.SendResetPasswordEmail(existingUser);
                }

                // Always return success so email addresses cannot be enumerated
                return Json(new ApiResponse { success = true, message = "If an account exists for this email, a password reset link has been sent." });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("register")]
        [AllowAnonymous]
        public async Task<IActionResult> Register([FromBody] NewUser user)
        {
            if (string.IsNullOrEmpty(user.Email)) return BadRequest("Email is required.");
            var emailRegex = new Regex("^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,10}$");
            if (!emailRegex.IsMatch(user.Email)) return BadRequest("Email is invalid.");
            if (string.IsNullOrEmpty(user.Password)) return BadRequest("Password is required.");
            if (user.Password.Length < 8) return Json(new ApiResponse { success = false, message = "Password must be at least 8 characters" });
            if (!user.Password.Any(char.IsUpper)) return Json(new ApiResponse { success = false, message = "Password must contain at least one uppercase letter" });
            if (!user.Password.Any(char.IsDigit)) return Json(new ApiResponse { success = false, message = "Password must contain at least one number" });
            if (string.IsNullOrEmpty(user.FullName)) return BadRequest("Full name is required.");

            try
            {
                var userExists = await _userRepository.FindByUserEmailAsync(user.Email);
                if (userExists != null && userExists.Email == user.Email)
                {
                    return Json(new ApiResponse { success = false, message = "An account with this email address already exists" });
                }

                AppUser newUser = new AppUser();
                newUser.Email = user.Email;
                newUser.FullName = user.FullName;
                newUser.Status = AppUserStatus.Active;
                var roles = await _roleRepository.GetAll();
                var isFirstUser = _userRepository.GetTotalUsers() == 0;
                newUser.EmailConfirmed = isFirstUser;
                _authService.GenerateResetPasswordHash(newUser, 24);
                newUser.PasswordHash = new PasswordHasher<object>().HashPassword(new object(), user.Password);

                var defaultRole = roles.FirstOrDefault(a => a.Name == (isFirstUser ? "admin" : "user"));
                if (defaultRole != null)
                {
                    newUser.UserRoles = new List<AppUserRole> { new AppUserRole() { AppRoleId = defaultRole.Id } };
                }

                newUser = await _userRepository.Add(newUser);
                if (!isFirstUser)
                {
                    _emailService.SendNewUserEmail(newUser);
                }
                return Json(new ApiResponse { success = true, data = new { isFirstUser, user = newUser } });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpGet("get/{id}")]
        [Authorize(Policy = nameof(AuthConstants.Policy.ManageUsers))]
        public async Task<IActionResult> Get(string id)
        {
            Guid userGuid;
            if (Guid.TryParse(id, out userGuid))
            {
                try
                {
                    var user = await _userRepository.FindByGuidAsync(userGuid);
                    if (user == null) return Json(new ApiResponse { success = false, data = null });
                    user.PasswordHash = null;
                    return Json(new ApiResponse { success = true, data = user });
                }
                catch (Exception ex)
                {
                    return Json(new ApiResponse { success = false, message = ex.Message });
                }
            }
            else return Json(new ApiResponse { success = false, message = "User not found" });
        }

        [HttpGet("my-info")]
        [Authorize]
        public async Task<IActionResult> GetMyInfo()
        {
            var userId = GetUserId();
            if (userId == Guid.Empty)
                return Json(new ApiResponse { success = false, message = "Could not find user" });

            try
            {
                var user = await _userRepository.FindByGuidAsync(userId);
                if (user == null)
                    return Json(new ApiResponse { success = false, message = "User not found" });
                user.PasswordHash = null;
                return Json(new ApiResponse { success = true, data = user });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("edit")]
        [Authorize(Policy = nameof(AuthConstants.Policy.ManageUsers))]
        public async Task<IActionResult> Edit([FromBody] UpdateUser user)
        {
            try
            {
                var savedUser = await _userRepository.FindByGuidAsync(user.Id);
                if (savedUser == null)
                    return Json(new ApiResponse { success = false, message = "User not found" });

                savedUser.FullName = user.FullName;
                savedUser.Status = (AppUserStatus)user.Status;
                if (!string.IsNullOrEmpty(user.Password))
                    savedUser.PasswordHash = new PasswordHasher<object>().HashPassword(new object(), user.Password);

                _userRepository.UpdateInfo(savedUser);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpDelete("delete/{id}")]
        [Authorize(Policy = nameof(AuthConstants.Policy.ManageUsers))]
        public async Task<IActionResult> Delete(string id)
        {
            Guid userGuid;
            if (Guid.TryParse(id, out userGuid))
            {
                try
                {
                    await _userRepository.DeleteUserAsync(userGuid);
                    return Json(new ApiResponse { success = true });
                }
                catch (Exception ex)
                {
                    return Json(new ApiResponse { success = false, message = ex.Message });
                }
            }
            else return Json(new ApiResponse { success = false, message = "User not found" });
        }
    }
}
