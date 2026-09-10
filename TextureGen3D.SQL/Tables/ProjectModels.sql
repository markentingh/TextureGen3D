CREATE TABLE IF NOT EXISTS public."ProjectModels" (
    "Id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "ProjectId" UUID NOT NULL,
    "Filename" VARCHAR(500) NOT NULL DEFAULT '',
    "Extension" VARCHAR(20) NOT NULL DEFAULT '',
    "FileSize" INTEGER NOT NULL DEFAULT 0,
    "Created" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FK_ProjectModels_Projects" FOREIGN KEY ("ProjectId") REFERENCES public."Projects"("Id") ON DELETE CASCADE
);
