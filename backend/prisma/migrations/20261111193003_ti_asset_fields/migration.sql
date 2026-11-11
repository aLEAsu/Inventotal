-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "endUser" TEXT,
ADD COLUMN     "hostname" TEXT,
ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "licenseExpiresAt" DATE,
ADD COLUMN     "macAddress" TEXT,
ADD COLUMN     "operatingSystem" TEXT,
ADD COLUMN     "processor" TEXT,
ADD COLUMN     "ramGb" INTEGER,
ADD COLUMN     "softwareVersion" TEXT,
ADD COLUMN     "storageGb" INTEGER;

-- CreateIndex
CREATE INDEX "assets_hostname_idx" ON "assets"("hostname");

-- CreateIndex
CREATE INDEX "assets_ipAddress_idx" ON "assets"("ipAddress");
