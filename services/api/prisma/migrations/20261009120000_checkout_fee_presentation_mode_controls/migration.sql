DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CheckoutFeePresentation') THEN
    CREATE TYPE "CheckoutFeePresentation" AS ENUM ('SEPARATE', 'COMBINED');
  END IF;
END $$;

ALTER TABLE "App"
  ADD COLUMN IF NOT EXISTS "mode1CollectionsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "mode2CollectionsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "checkoutFeePresentation" "CheckoutFeePresentation" NOT NULL DEFAULT 'SEPARATE';
