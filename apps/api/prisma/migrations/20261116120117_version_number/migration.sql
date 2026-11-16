-- Stable version numbers (Step 10): only the newest 3 Version rows are kept per project,
-- so numbers can no longer be worked out by counting rows. Existing rows are numbered
-- 1, 2, 3, ... per project in the order they were created.
ALTER TABLE "Version" ADD COLUMN "number" INTEGER;
UPDATE "Version" v SET "number" = n.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "projectId" ORDER BY "createdAt", "id") AS rn
  FROM "Version"
) n
WHERE v."id" = n."id";
ALTER TABLE "Version" ALTER COLUMN "number" SET NOT NULL;
CREATE UNIQUE INDEX "Version_projectId_number_key" ON "Version"("projectId", "number");
