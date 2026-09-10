CREATE INDEX IF NOT EXISTS "IX_ProjectImageGenerations_ProjectId" ON public."ProjectImageGenerations" ("ProjectId");
CREATE INDEX IF NOT EXISTS "IX_ProjectImageGenerations_DateCreated" ON public."ProjectImageGenerations" ("DateCreated");
CREATE INDEX IF NOT EXISTS "IX_ProjectImageGenerations_Date" ON public."ProjectImageGenerations" ("DateYear", "DateMonth", "DateDay");
