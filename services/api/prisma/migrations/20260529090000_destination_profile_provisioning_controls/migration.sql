ALTER TABLE "App"
  ADD COLUMN "destinationProfileProvisioningEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "destinationProfileAutoVerifyEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "destinationProfileLimit" INTEGER NOT NULL DEFAULT 0;

