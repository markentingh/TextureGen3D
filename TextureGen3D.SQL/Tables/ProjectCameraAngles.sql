CREATE TABLE IF NOT EXISTS public."ProjectCameraAngles" (
    "Id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "ProjectId" UUID NOT NULL,
    "ModelId" UUID NOT NULL,
    "MeshId" UUID NOT NULL,
    "Rotation" TEXT NOT NULL DEFAULT '{}',
    "Created" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FK_ProjectCameraAngles_Projects" FOREIGN KEY ("ProjectId") REFERENCES public."Projects"("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_ProjectCameraAngles_ProjectModels" FOREIGN KEY ("ModelId") REFERENCES public."ProjectModels"("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_ProjectCameraAngles_ProjectMeshes" FOREIGN KEY ("MeshId") REFERENCES public."ProjectMeshes"("Id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "IX_ProjectCameraAngles_ProjectId" ON public."ProjectCameraAngles" ("ProjectId");
CREATE INDEX IF NOT EXISTS "IX_ProjectCameraAngles_MeshId" ON public."ProjectCameraAngles" ("MeshId");
CREATE INDEX IF NOT EXISTS "IX_ProjectCameraAngles_ModelId" ON public."ProjectCameraAngles" ("ModelId");
