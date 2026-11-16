-- Step 11: where a project is published on the management droplet.
ALTER TABLE "Project" ADD COLUMN "slug" TEXT;
ALTER TABLE "Project" ADD COLUMN "liveUrl" TEXT;
ALTER TABLE "Project" ADD COLUMN "publishedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");
