using TextureGen3D.API.Models;
using TextureGen3D.API.Services;
using TextureGen3D.Auth.Services;
using TextureGen3D.Auth.Policies;
using TextureGen3D.Data.Entities.Auth;
using TextureGen3D.Data.Interfaces.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace TextureGen3D.API.Controllers.Admin
{
    [Route("/api/admin/users")]
    [Authorize(Policy = nameof(AuthConstants.Policy.ManageUsers))]
    public class UsersController : ApiController
    {
        readonly IAuthService _authRepo;
        readonly IAppUserRepository _userRepo;
        readonly IAppRoleRepository _roleRepo;
        readonly IEmailService _emailService;

        public UsersController(
            IAuthService authRepo,
            IAppUserRepository userRepo,
            IAppRoleRepository roleRepo,
            IEmailService emailService
        )
        {
            _authRepo = authRepo;
            _userRepo = userRepo;
            _roleRepo = roleRepo;
            _emailService = emailService;
        }

        [HttpGet("get-all")]
        public async Task<IActionResult> GetAll()
        {
            try
            {
                var users = (await _userRepo.GetAll()).Select(a => new { a.Email, a.FullName, a.Id, a.LastLogin, a.Status, a.Created });
                return Json(new ApiResponse { success = true, data = users });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("get-all-filtered")]
        public async Task<IActionResult> GetAllFiltered([FromBody] UserFilter filter)
        {
            try
            {
                int page = filter.Start / filter.Length + 1;
                var result = await _userRepo.GetAllFiltered(filter.FullName, filter.Role, filter.Sort, page, filter.Length);
                return Json(new ApiResponse
                {
                    success = true,
                    data = new
                    {
                        items = result.items,
                        totalCount = result.totalCount
                    }
                });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpGet("get-roles")]
        public async Task<IActionResult> GetRoles()
        {
            try
            {
                var roles = await _roleRepo.GetAll();
                return Json(new ApiResponse { success = true, data = roles });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("update-lock")]
        public async Task<IActionResult> UpdateLock([FromBody] UpdateLockRequest request)
        {
            try
            {
                var success = await _userRepo.UpdateLock(request.UserId, request.LockUser);
                return Json(new ApiResponse { success = success });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("update-full-name")]
        public async Task<IActionResult> UpdateFullName([FromBody] UpdateUser request)
        {
            try
            {
                var user = await _userRepo.FindByGuidAsync(request.Id);
                if (user == null)
                {
                    return Json(new ApiResponse { success = false, message = "User not found" });
                }
                user.FullName = request.FullName;
                _userRepo.UpdateInfo(user);
                return Json(new ApiResponse { success = true });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }

        [HttpPost("send-password-reset")]
        public async Task<IActionResult> SendPasswordReset([FromBody] SendPasswordResetRequest request)
        {
            try
            {
                var user = await _userRepo.FindByGuidAsync(request.UserId);
                if (user == null)
                {
                    return Json(new ApiResponse { success = false, message = "User not found" });
                }
                user = await _userRepo.UpdatePasswordResetHash(user);
                _emailService.SendResetPasswordEmail(user);
                return Json(new ApiResponse { success = true, message = "Password reset email sent" });
            }
            catch (Exception ex)
            {
                return Json(new ApiResponse { success = false, message = ex.Message });
            }
        }
    }
}
