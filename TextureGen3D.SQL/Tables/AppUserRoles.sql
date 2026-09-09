CREATE TABLE IF NOT EXISTS public."AppUserRoles" (
    "Id" SERIAL PRIMARY KEY,
    "AppUserId" UUID NOT NULL,
    "AppRoleId" INTEGER NOT NULL,
    CONSTRAINT "FK_AppUserRoles_AppUsers" FOREIGN KEY ("AppUserId") REFERENCES public."AppUsers"("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_AppUserRoles_AppRoles" FOREIGN KEY ("AppRoleId") REFERENCES public."AppRoles"("Id") ON DELETE CASCADE,
    CONSTRAINT "UQ_AppUserRoles_UserRole" UNIQUE ("AppUserId", "AppRoleId")
);
