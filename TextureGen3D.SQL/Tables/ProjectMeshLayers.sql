CREATE TABLE IF NOT EXISTS public."ProjectMeshLayers" (
    "Id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "ProjectId" UUID NOT NULL,
    "ProjectMeshId" UUID NOT NULL,
    "Name" VARCHAR(32) NOT NULL DEFAULT '',
    "Index" INTEGER NOT NULL DEFAULT 0,
    "CameraAngle" VARCHAR(64) NOT NULL DEFAULT '',
    "Visible" BOOLEAN NOT NULL DEFAULT TRUE,
    "Created" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FK_ProjectMeshLayers_Projects" FOREIGN KEY ("ProjectId") REFERENCES public."Projects"("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_ProjectMeshLayers_ProjectMeshes" FOREIGN KEY ("ProjectMeshId") REFERENCES public."ProjectMeshes"("Id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "IX_ProjectMeshLayers_ProjectMeshId" ON public."ProjectMeshLayers" ("ProjectMeshId");

ALTER TABLE public."ProjectMeshLayers" ADD COLUMN IF NOT EXISTS "Visible" BOOLEAN NOT NULL DEFAULT TRUE;
