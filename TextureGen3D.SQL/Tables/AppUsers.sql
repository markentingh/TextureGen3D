CREATE TABLE IF NOT EXISTS public."AppUsers" (
    "Id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "FullName" VARCHAR(255) NOT NULL,
    "Email" VARCHAR(255) NOT NULL UNIQUE,
    "EmailConfirmed" BOOLEAN NOT NULL DEFAULT FALSE,
    "PasswordHash" VARCHAR(255) NOT NULL,
    "LockoutEndDate" TIMESTAMP NULL,
    "LockoutEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
    "AccessFailedCount" INTEGER NOT NULL DEFAULT 0,
    "AccessFailedTime" TIMESTAMP NULL,
    "PasswordResetHash" VARCHAR(255) NULL,
    "PasswordResetTime" TIMESTAMP NULL,
    "NewEmail" VARCHAR(255) NULL,
    "Status" INTEGER NOT NULL DEFAULT 1,
    "Created" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
