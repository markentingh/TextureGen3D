using System.Net;
using System.Net.Mail;
using TextureGen3D.API.Models;
using TextureGen3D.Auth.Services;
using TextureGen3D.Data.Entities.Auth;
using Microsoft.Extensions.Options;
using SendGrid;
using SendGrid.Helpers.Mail;

namespace TextureGen3D.API.Services
{
    public interface IEmailService
    {
        void SendNewUserEmail(AppUser user);
        void SendResetPasswordEmail(AppUser user);
    }

    public class EmailService : IEmailService
    {
        readonly IAuthService _authService;
        private readonly EmailSettings _settings;
        private readonly string _domain;

        public EmailService(
            IAuthService authService,
            IOptions<EmailSettings> settings
        )
        {
            _authService = authService;
            _settings = settings.Value;
            _domain = _authService.Settings().Domain;
        }

        public void SendEmail(string to, string subject, string htmlBody)
        {
            var from = new MailAddress(_settings.DefaultFromEmail, _settings.DefaultFromName);

            if (_settings.UseSendGrid && !string.IsNullOrEmpty(_settings.SendGridApiKey))
            {
                var client = new SendGridClient(_settings.SendGridApiKey);
                var msg = new SendGridMessage()
                {
                    From = new EmailAddress(from.Address, from.DisplayName),
                    Subject = subject,
                    HtmlContent = htmlBody
                };
                msg.AddTo(new EmailAddress(to));
                if (!string.IsNullOrEmpty(_settings.TrackingEmail))
                {
                    msg.AddBcc(new EmailAddress(_settings.TrackingEmail));
                }

                var response = client.SendEmailAsync(msg).Result;
                if (response.StatusCode == HttpStatusCode.Forbidden)
                {
                    throw new Exception("Cannot send email via SendGrid");
                }
            }
            else
            {
                using var msg = new MailMessage();
                msg.To.Add(to);
                msg.Subject = subject;
                msg.IsBodyHtml = true;
                msg.Body = htmlBody;
                msg.From = from;
                if (!string.IsNullOrEmpty(_settings.TrackingEmail))
                {
                    msg.Bcc.Add(_settings.TrackingEmail);
                }

                using var smtp = new SmtpClient("localhost");
                smtp.Send(msg);
            }
        }

        public void SendNewUserEmail(AppUser user)
        {
            var url = $"{_domain}/activate/{user.PasswordResetHash}";

            var body = $@"
                <p>You have a new account for <strong>{WebUtility.HtmlEncode(_domain)}</strong>.</p>
                <br />
                <p>
                    Please follow the link below to activate your account.
                    <br />
                    <a href=""{url}""><b>Activate My Account</b></a>
                </p>
                <br/>

                <p>You can optionally copy the link below into your web browser to activate your account.<br />
                <span style=""word-wrap: break-word;""><b>{url}</b></span><br /></p>
            ";

            SendEmail(user.Email, "Activate your TextureGen3D account", body);
        }

        public void SendResetPasswordEmail(AppUser user)
        {
            var url = $"{_domain}/create-password/{user.PasswordResetHash}";

            var body = $@"
                <p>Your password needs to be reset for <strong>{WebUtility.HtmlEncode(_domain)}</strong>.</p>
                <br />
                <p>
                    Please follow the link below to reset your password.
                    <br />
                    <a href=""{url}""><b>Reset Password</b></a>
                </p>
                <br/>

                <p>You can optionally copy the link below into your web browser to update your password.<br />
                <span style=""word-wrap: break-word;""><b>{url}</b></span><br /></p>
            ";

            SendEmail(user.Email, "Reset your TextureGen3D password", body);
        }
    }
}
