CREATE INDEX IF NOT EXISTS "IX_AppUsers_Email" ON public."AppUsers" ("Email");
CREATE INDEX IF NOT EXISTS "IX_AppUsers_PasswordResetHash" ON public."AppUsers" ("PasswordResetHash");
CREATE INDEX IF NOT EXISTS "IX_AppUserRoles_AppUserId" ON public."AppUserRoles" ("AppUserId");
CREATE INDEX IF NOT EXISTS "IX_AppUserTokens_Token" ON public."AppUserTokens" ("Token");
