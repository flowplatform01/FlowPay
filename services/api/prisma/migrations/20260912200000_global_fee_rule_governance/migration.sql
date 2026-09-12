-- DropForeignKey
ALTER TABLE "FeeRule" DROP CONSTRAINT IF EXISTS "FeeRule_organizationId_fkey";

-- AlterTable
ALTER TABLE "FeeRule" ALTER COLUMN "organizationId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FeeRule_organizationId_isActive_idx" ON "FeeRule"("organizationId", "isActive");

-- AddForeignKey
ALTER TABLE "FeeRule" ADD CONSTRAINT "FeeRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
