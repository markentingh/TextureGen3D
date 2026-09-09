using TextureGen3D.Auth.Policies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using System.Security.Claims;

namespace TextureGen3D.Auth.Services
{
    public static class SetupPolicies
    {
        public static void AddPolicies(this WebApplicationBuilder builder)
        {
            builder.Services.AddAuthorization(options =>
            {
                options.Add(AuthConstants.Policy.ManageUsers, policy => policy.Admins());
            });
        }

        private static void Add(this AuthorizationOptions options, AuthConstants.Policy type, Action<AuthorizationPolicyBuilder> policy)
        {
            options.AddPolicy(Enum.GetName(type) ?? type.ToString(), policy);
        }

        private static AuthorizationPolicyBuilder Admins(this AuthorizationPolicyBuilder policy)
        {
            return policy.RequireClaim(ClaimTypes.Role, nameof(AuthConstants.RoleType.admin));
        }
    }
}
