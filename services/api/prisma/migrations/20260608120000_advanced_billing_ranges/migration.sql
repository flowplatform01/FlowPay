-- CreateEnum
CREATE TYPE "FeeRangeFallbackStrategy" AS ENUM ('USE_STANDARD_RULE', 'REJECT', 'ZERO_FEE');

-- AlterTable
ALTER TABLE "FeeRule" ADD COLUMN "advancedBillingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FeeRule" ADD COLUMN "rangeFallbackStrategy" "FeeRangeFallbackStrategy" NOT NULL DEFAULT 'USE_STANDARD_RULE';

-- CreateTable
CREATE TABLE "FeeRuleRange" (
    "id" TEXT NOT NULL,
    "feeRuleId" TEXT NOT NULL,
    "name" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "minAmount" DECIMAL(18,2) NOT NULL,
    "maxAmount" DECIMAL(18,2),
    "type" "FeeRuleType" NOT NULL,
    "flatAmount" DECIMAL(18,2),
    "percentageRate" DECIMAL(8,4),
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeRuleRange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeeRuleRange_feeRuleId_sortOrder_idx" ON "FeeRuleRange"("feeRuleId", "sortOrder");

-- AddForeignKey
ALTER TABLE "FeeRuleRange" ADD CONSTRAINT "FeeRuleRange_feeRuleId_fkey" FOREIGN KEY ("feeRuleId") REFERENCES "FeeRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
