CREATE TABLE IF NOT EXISTS public."ProjectMeshes" (
    "Id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "ProjectId" UUID NOT NULL,
    "ModelId" UUID NOT NULL,
    "Name" VARCHAR(500) NOT NULL DEFAULT '',
    "MeshData" TEXT NOT NULL DEFAULT '',
    "UVMapData" TEXT NOT NULL DEFAULT '',
    "Triangles" INTEGER NOT NULL DEFAULT 0,
    "Vertices" INTEGER NOT NULL DEFAULT 0,
    "Created" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FK_ProjectMeshes_Projects" FOREIGN KEY ("ProjectId") REFERENCES public."Projects"("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_ProjectMeshes_ProjectModels" FOREIGN KEY ("ModelId") REFERENCES public."ProjectModels"("Id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "IX_ProjectMeshes_ProjectId" ON public."ProjectMeshes" ("ProjectId");
CREATE INDEX IF NOT EXISTS "IX_ProjectMeshes_ModelId" ON public."ProjectMeshes" ("ModelId");

ALTER TABLE public."ProjectMeshes" ADD COLUMN IF NOT EXISTS "Prompt" TEXT NOT NULL DEFAULT '';
