CREATE TABLE IF NOT EXISTS public."ProjectReferences" (
    "Id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "ProjectId" UUID NOT NULL,
    "Filename" VARCHAR(500) NOT NULL DEFAULT '',
    "Extension" VARCHAR(20) NOT NULL DEFAULT 'png',
    "FileSize" INTEGER NOT NULL DEFAULT 0,
    "Width" INTEGER NOT NULL DEFAULT 0,
    "Height" INTEGER NOT NULL DEFAULT 0,
    "Active" BOOLEAN NOT NULL DEFAULT TRUE,
    "Created" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FK_ProjectReferences_Projects" FOREIGN KEY ("ProjectId") REFERENCES public."Projects"("Id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "IX_ProjectReferences_ProjectId" ON public."ProjectReferences" ("ProjectId");
