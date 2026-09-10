CREATE TABLE IF NOT EXISTS public."Projects" (
    "Id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "AppUserId" UUID NOT NULL,
    "Title" VARCHAR(255) NOT NULL,
    "Description" TEXT,
    "Key" VARCHAR(255) NOT NULL DEFAULT '',
    "Color" VARCHAR(50) NOT NULL DEFAULT '',
    "Status" INTEGER NOT NULL DEFAULT 1,
    "Created" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FK_Projects_AppUsers" FOREIGN KEY ("AppUserId") REFERENCES public."AppUsers"("Id") ON DELETE CASCADE
);
