CREATE TABLE IF NOT EXISTS public."ProjectImageUpscales" (
    "Id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "ProjectId" UUID NOT NULL,
    "Width" INTEGER NOT NULL DEFAULT 0,
    "Height" INTEGER NOT NULL DEFAULT 0,
    "Scale" INTEGER NOT NULL DEFAULT 2,
    "Created" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FK_ProjectImageUpscales_Projects" FOREIGN KEY ("ProjectId") REFERENCES public."Projects"("Id") ON DELETE CASCADE
);
