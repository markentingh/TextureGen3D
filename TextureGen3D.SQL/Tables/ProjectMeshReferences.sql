CREATE TABLE IF NOT EXISTS public."ProjectMeshReferences" (
    "Id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "ProjectId" UUID NOT NULL,
    "ProjectMeshId" UUID NOT NULL,
    "ProjectReferenceId" UUID NOT NULL,
    "Active" BOOLEAN NOT NULL DEFAULT TRUE,
    "Created" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FK_ProjectMeshReferences_Projects" FOREIGN KEY ("ProjectId") REFERENCES public."Projects"("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_ProjectMeshReferences_ProjectMeshes" FOREIGN KEY ("ProjectMeshId") REFERENCES public."ProjectMeshes"("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_ProjectMeshReferences_ProjectReferences" FOREIGN KEY ("ProjectReferenceId") REFERENCES public."ProjectReferences"("Id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "IX_ProjectMeshReferences_ProjectMeshId" ON public."ProjectMeshReferences" ("ProjectMeshId");
CREATE INDEX IF NOT EXISTS "IX_ProjectMeshReferences_ProjectReferenceId" ON public."ProjectMeshReferences" ("ProjectReferenceId");
