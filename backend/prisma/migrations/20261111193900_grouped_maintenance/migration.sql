CREATE TYPE "ProgramTargetType" AS ENUM ('ACTIVO', 'CATEGORIA', 'SUBCATEGORIA', 'GRUPO');
CREATE TYPE "ProgramDisplayMode" AS ENUM ('POR_ACTIVO', 'AGRUPADO');

ALTER TYPE "FrequencyType" ADD VALUE 'SEMANA_DEL_MES';

CREATE TABLE "maintenance_groups" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "maintenance_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "maintenance_group_members" (
    "groupId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    CONSTRAINT "maintenance_group_members_pkey" PRIMARY KEY ("groupId", "assetId")
);

ALTER TABLE "maintenance_programs"
    ALTER COLUMN "assetId" DROP NOT NULL,
    ALTER COLUMN "categoryId" DROP NOT NULL,
    ADD COLUMN "targetType" "ProgramTargetType" NOT NULL DEFAULT 'ACTIVO',
    ADD COLUMN "displayMode" "ProgramDisplayMode" NOT NULL DEFAULT 'POR_ACTIVO',
    ADD COLUMN "subcategoryId" UUID,
    ADD COLUMN "groupId" UUID,
    ADD COLUMN "monthsOfYear" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    ADD COLUMN "weekOfMonth" INTEGER,
    ADD COLUMN "dayOfWeek" INTEGER;

ALTER TABLE "maintenance_programs"
    ADD CONSTRAINT "maintenance_programs_subcategoryId_fkey"
        FOREIGN KEY ("subcategoryId") REFERENCES "asset_subcategories"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "maintenance_programs_groupId_fkey"
        FOREIGN KEY ("groupId") REFERENCES "maintenance_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "maintenance_programs_target_check" CHECK (
        ("targetType" = 'ACTIVO' AND "assetId" IS NOT NULL AND "categoryId" IS NOT NULL AND "subcategoryId" IS NULL AND "groupId" IS NULL)
        OR ("targetType" = 'CATEGORIA' AND "assetId" IS NULL AND "categoryId" IS NOT NULL AND "subcategoryId" IS NULL AND "groupId" IS NULL)
        OR ("targetType" = 'SUBCATEGORIA' AND "assetId" IS NULL AND "categoryId" IS NOT NULL AND "subcategoryId" IS NOT NULL AND "groupId" IS NULL)
        OR ("targetType" = 'GRUPO' AND "assetId" IS NULL AND "categoryId" IS NULL AND "subcategoryId" IS NULL AND "groupId" IS NOT NULL)
    ),
    ADD CONSTRAINT "maintenance_programs_grouped_display_check" CHECK (
        "displayMode" = 'POR_ACTIVO' OR "targetType" <> 'ACTIVO'
    );

CREATE UNIQUE INDEX "maintenance_groups_name_key" ON "maintenance_groups"("name");
CREATE INDEX "maintenance_groups_isActive_idx" ON "maintenance_groups"("isActive");
CREATE INDEX "maintenance_group_members_assetId_idx" ON "maintenance_group_members"("assetId");
CREATE INDEX "maintenance_programs_targetType_categoryId_subcategoryId_idx"
    ON "maintenance_programs"("targetType", "categoryId", "subcategoryId");
CREATE INDEX "maintenance_programs_groupId_idx" ON "maintenance_programs"("groupId");

DROP INDEX "scheduled_activities_planId_programId_periodKey_key";
CREATE UNIQUE INDEX "scheduled_activities_planId_programId_assetId_periodKey_key"
    ON "scheduled_activities"("planId", "programId", "assetId", "periodKey");

ALTER TABLE "maintenance_groups"
    ADD CONSTRAINT "maintenance_groups_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "maintenance_group_members"
    ADD CONSTRAINT "maintenance_group_members_groupId_fkey"
        FOREIGN KEY ("groupId") REFERENCES "maintenance_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "maintenance_group_members_assetId_fkey"
        FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
