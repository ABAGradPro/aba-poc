-- Each project gets a readable folder name (see src/projects/workspace.ts: folderFor).
-- Existing projects keep their current folder (named by id) until
-- `pnpm --filter api folders:rename` renames them to the new style.
ALTER TABLE "Project" ADD COLUMN "folder" TEXT;
UPDATE "Project" SET "folder" = "id"::text WHERE "folder" IS NULL;
ALTER TABLE "Project" ALTER COLUMN "folder" SET NOT NULL;
CREATE UNIQUE INDEX "Project_folder_key" ON "Project"("folder");
