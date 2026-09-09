namespace TextureGen3D.Auth.Models
{
    public class AuthSettings
    {
        public string Domain { get; set; } = "";
        public string CentralAuthKey { get; set; } = "";
        public JwtTokenSettings JWT { get; set; } = new JwtTokenSettings();
    }

    public class JwtTokenSettings
    {
        public string ValidIssuer { get; set; } = "";
        public string ValidAudience { get; set; } = "";
        public string Secret { get; set; } = "";
        public string ExpiryMins { get; set; } = "60";
        public string RefreshExpiryMins { get; set; } = "10080";
        public bool UseRollingRefreshTokens { get; set; } = true;
    }
}
