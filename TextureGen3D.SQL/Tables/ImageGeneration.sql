CREATE TABLE IF NOT EXISTS public."ImageGeneration" (
    "Id" SERIAL PRIMARY KEY,
    "ModelKey" VARCHAR(100) NOT NULL DEFAULT '',
    "Name" VARCHAR(255) NOT NULL DEFAULT '',
    "Model" VARCHAR(255) NOT NULL DEFAULT '',
    "CPMITTokens" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "CPMIITokens" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "CPMOTokens" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "Type" INTEGER NOT NULL DEFAULT 0,
    "CP1K" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "CP2K" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "CP4K" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "CP8K" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "WorkflowJson" TEXT NULL DEFAULT NULL,
    "PromptPath" TEXT NULL DEFAULT NULL,
    "DepthMapPath" TEXT NULL DEFAULT NULL,
    "InputImagesPath" TEXT NULL DEFAULT NULL,
    "Active" BOOLEAN NOT NULL DEFAULT TRUE,
    "DateCreated" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "DateUpdated" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add columns if they don't exist (for existing databases)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ImageGeneration' AND column_name = 'WorkflowJson') THEN
        ALTER TABLE public."ImageGeneration" ADD COLUMN "WorkflowJson" TEXT NULL DEFAULT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ImageGeneration' AND column_name = 'PromptPath') THEN
        ALTER TABLE public."ImageGeneration" ADD COLUMN "PromptPath" TEXT NULL DEFAULT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ImageGeneration' AND column_name = 'DepthMapPath') THEN
        ALTER TABLE public."ImageGeneration" ADD COLUMN "DepthMapPath" TEXT NULL DEFAULT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ImageGeneration' AND column_name = 'InputImagesPath') THEN
        ALTER TABLE public."ImageGeneration" ADD COLUMN "InputImagesPath" TEXT NULL DEFAULT NULL;
    END IF;
END $$;
