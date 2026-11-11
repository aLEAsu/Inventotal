-- CreateEnum
CREATE TYPE "AreaScope" AS ENUM ('ALL', 'AREA', 'OWN');

-- CreateEnum
CREATE TYPE "Criticality" AS ENUM ('CRITICA', 'ALTA', 'MEDIA', 'BAJA');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('OPERATIVO', 'OPERATIVO_CON_OBSERVACIONES', 'EN_MANTENIMIENTO', 'FUERA_DE_SERVICIO', 'RETIRADO', 'DADO_DE_BAJA');

-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('INTERNO', 'EXTERNO');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('VIGENTE', 'VENCIDO', 'TERMINADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "MaintenanceKind" AS ENUM ('PREVENTIVO', 'INSPECCION', 'CALIBRACION', 'VERIFICACION_METROLOGICA', 'LIMPIEZA', 'PRUEBA_FUNCIONAL', 'OTRO');

-- CreateEnum
CREATE TYPE "FrequencyType" AS ENUM ('SEMANAL', 'QUINCENAL', 'MENSUAL', 'BIMESTRAL', 'TRIMESTRAL', 'CUATRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'PERSONALIZADO', 'FECHAS_ESPECIFICAS');

-- CreateEnum
CREATE TYPE "IntervalUnit" AS ENUM ('DIAS', 'SEMANAS', 'MESES');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('BORRADOR', 'EN_REVISION', 'APROBADO', 'CERRADO');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('PROGRAMADO', 'EN_EJECUCION', 'EJECUTADO', 'REPROGRAMADO', 'CANCELADO', 'NO_APLICA');

-- CreateEnum
CREATE TYPE "RescheduleStatus" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA');

-- CreateEnum
CREATE TYPE "WorkOrderType" AS ENUM ('PREVENTIVA', 'CORRECTIVA');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('URGENTE', 'ALTA', 'MEDIA', 'BAJA');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('ABIERTA', 'ASIGNADA', 'EN_EJECUCION', 'PENDIENTE_REPUESTOS', 'PENDIENTE_PROVEEDOR', 'PENDIENTE_VALIDACION', 'CERRADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "FinalCondition" AS ENUM ('OPERATIVO', 'OPERATIVO_CON_OBSERVACIONES', 'FUERA_DE_SERVICIO', 'REQUIERE_BAJA');

-- CreateEnum
CREATE TYPE "FailureStatus" AS ENUM ('REPORTADA', 'EN_EVALUACION', 'ASIGNADA', 'EN_ATENCION', 'RESUELTA', 'CERRADA', 'ANULADA');

-- CreateEnum
CREATE TYPE "AssetConditionOnReport" AS ENUM ('FUNCIONA_NORMAL', 'FUNCIONA_CON_LIMITACIONES', 'NO_FUNCIONA', 'RIESGO_SEGURIDAD');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('MANUAL_TECNICO', 'FICHA_TECNICA', 'CERTIFICADO', 'INFORME_MANTENIMIENTO', 'FOTOGRAFIA', 'ACTA_SERVICIO', 'COTIZACION', 'FACTURA', 'GARANTIA', 'CONTRATO', 'OTRO');

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "counters" (
    "key" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("key","year")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" "AreaScope" NOT NULL DEFAULT 'ALL',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionCode" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionCode")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "fullName" TEXT NOT NULL,
    "documentId" TEXT,
    "position" TEXT,
    "passwordHash" TEXT NOT NULL,
    "roleId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isTechnicalStaff" BOOLEAN NOT NULL DEFAULT false,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "lastLoginAt" TIMESTAMPTZ(6),
    "passwordChangedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_areas" (
    "userId" UUID NOT NULL,
    "areaId" UUID NOT NULL,

    CONSTRAINT "user_areas_pkey" PRIMARY KEY ("userId","areaId")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" BIGSERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "ip" TEXT,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "building" TEXT,
    "floor" TEXT,
    "areaId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_categories" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_subcategories" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "asset_subcategories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" UUID NOT NULL,
    "subcategoryId" UUID,
    "description" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "locationId" UUID,
    "areaId" UUID NOT NULL,
    "acquisitionDate" DATE,
    "installationDate" DATE,
    "manufacturer" TEXT,
    "supplierId" UUID,
    "warrantyUntil" DATE,
    "warrantyInfo" TEXT,
    "acquisitionCost" DECIMAL(14,2),
    "criticality" "Criticality" NOT NULL DEFAULT 'MEDIA',
    "status" "AssetStatus" NOT NULL DEFAULT 'OPERATIVO',
    "responsibleId" UUID,
    "notes" TEXT,
    "statusReason" TEXT,
    "decommissionedAt" DATE,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_status_history" (
    "id" BIGSERIAL NOT NULL,
    "assetId" UUID NOT NULL,
    "fromStatus" "AssetStatus",
    "toStatus" "AssetStatus" NOT NULL,
    "reason" TEXT,
    "userId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "criticality_criteria" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "weight" DECIMAL(6,2) NOT NULL,
    "maxScore" INTEGER NOT NULL DEFAULT 5,
    "scaleGuide" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "criticality_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "criticality_assessments" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "scores" JSONB NOT NULL,
    "totalScore" DECIMAL(6,2) NOT NULL,
    "computedLevel" "Criticality" NOT NULL,
    "assignedLevel" "Criticality" NOT NULL,
    "justification" TEXT NOT NULL,
    "assessedById" UUID NOT NULL,
    "assessedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "criticality_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nit" TEXT,
    "type" "SupplierType" NOT NULL DEFAULT 'EXTERNO',
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "specialty" TEXT,
    "services" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "object" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "value" DECIMAL(14,2),
    "status" "ContractStatus" NOT NULL DEFAULT 'VIGENTE',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_assets" (
    "contractId" UUID NOT NULL,
    "assetId" UUID NOT NULL,

    CONSTRAINT "contract_assets_pkey" PRIMARY KEY ("contractId","assetId")
);

-- CreateTable
CREATE TABLE "supplier_evaluations" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "scores" JSONB NOT NULL,
    "totalScore" DECIMAL(5,2) NOT NULL,
    "observations" TEXT,
    "evaluatedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_programs" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "assetId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "kind" "MaintenanceKind" NOT NULL DEFAULT 'PREVENTIVO',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "procedure" TEXT,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "frequencyType" "FrequencyType" NOT NULL,
    "intervalValue" INTEGER,
    "intervalUnit" "IntervalUnit",
    "specificDates" TEXT[],
    "startDate" DATE NOT NULL,
    "baseDate" DATE NOT NULL,
    "endDate" DATE,
    "lastPerformedDate" DATE,
    "estimatedDurationMin" INTEGER,
    "responsibleId" UUID,
    "supplierId" UUID,
    "technicalRequirements" TEXT,
    "references" TEXT,
    "frequencyJustification" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "maintenance_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annual_plans" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "PlanStatus" NOT NULL DEFAULT 'BORRADOR',
    "documentCode" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'PLAN ANUAL DE MANTENIMIENTO',
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" UUID,
    "submittedAt" TIMESTAMPTZ(6),
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(6),
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(6),
    "closedById" UUID,
    "closedAt" TIMESTAMPTZ(6),
    "lastGeneratedAt" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "annual_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annual_plan_events" (
    "id" BIGSERIAL NOT NULL,
    "planId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" "PlanStatus",
    "toStatus" "PlanStatus",
    "version" INTEGER NOT NULL,
    "detail" JSONB,
    "reason" TEXT,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "annual_plan_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annual_plan_versions" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "approvedById" UUID NOT NULL,
    "approvedAt" TIMESTAMPTZ(6) NOT NULL,
    "activityCount" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT,

    CONSTRAINT "annual_plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_activities" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "periodKey" TEXT NOT NULL,
    "originalDate" DATE NOT NULL,
    "committedDate" DATE NOT NULL,
    "executedDate" DATE,
    "status" "ActivityStatus" NOT NULL DEFAULT 'PROGRAMADO',
    "responsibleId" UUID,
    "addedAfterApproval" BOOLEAN NOT NULL DEFAULT false,
    "programSnapshot" JSONB NOT NULL,
    "statusReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scheduled_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reschedules" (
    "id" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RescheduleStatus" NOT NULL DEFAULT 'PENDIENTE',
    "requestedById" UUID NOT NULL,
    "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(6),
    "decisionNote" TEXT,

    CONSTRAINT "reschedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "WorkOrderType" NOT NULL,
    "assetId" UUID NOT NULL,
    "areaId" UUID NOT NULL,
    "activityId" UUID,
    "failureReportId" UUID,
    "parentWorkOrderId" UUID,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIA',
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'ABIERTA',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "interventionType" TEXT,
    "scheduledDate" DATE,
    "dueDate" DATE,
    "assignedToId" UUID,
    "supplierId" UUID,
    "startedAt" TIMESTAMPTZ(6),
    "finishedAt" TIMESTAMPTZ(6),
    "activitiesPerformed" TEXT,
    "diagnosis" TEXT,
    "checklistResults" JSONB,
    "findings" TEXT,
    "result" TEXT,
    "testsPerformed" TEXT,
    "finalCondition" "FinalCondition",
    "laborCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "externalCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "partsCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMPTZ(6),
    "verificationNote" TEXT,
    "validatorSignature" TEXT,
    "pauseReason" TEXT,
    "cancelReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "closedAt" TIMESTAMPTZ(6),

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_parts" (
    "id" UUID NOT NULL,
    "workOrderId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "partNumber" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_events" (
    "id" BIGSERIAL NOT NULL,
    "workOrderId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" "WorkOrderStatus",
    "toStatus" "WorkOrderStatus",
    "note" TEXT,
    "changes" JSONB,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "failure_reports" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "reportedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reporterId" UUID NOT NULL,
    "areaId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assetCondition" "AssetConditionOnReport" NOT NULL,
    "serviceImpact" TEXT,
    "priorityInputs" JSONB NOT NULL,
    "priorityScore" DECIMAL(6,2) NOT NULL,
    "priority" "Priority" NOT NULL,
    "priorityOverrideReason" TEXT,
    "status" "FailureStatus" NOT NULL DEFAULT 'REPORTADA',
    "assignedToId" UUID,
    "firstResponseAt" TIMESTAMPTZ(6),
    "outOfService" BOOLEAN NOT NULL DEFAULT false,
    "downtimeStart" TIMESTAMPTZ(6),
    "downtimeEnd" TIMESTAMPTZ(6),
    "resolvedAt" TIMESTAMPTZ(6),
    "resolvedByWorkOrderId" UUID,
    "releaseAuthorizedById" UUID,
    "releaseAuthorizedAt" TIMESTAMPTZ(6),
    "releaseNote" TEXT,
    "closedAt" TIMESTAMPTZ(6),
    "cancelReason" TEXT,
    "observations" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "failure_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "type" "DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "assetId" UUID,
    "workOrderId" UUID,
    "failureReportId" UUID,
    "supplierId" UUID,
    "contractId" UUID,
    "planId" UUID,
    "uploadedById" UUID NOT NULL,
    "uploadedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMPTZ(6),
    "voidedById" UUID,
    "voidReason" TEXT,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_formats" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "documentCode" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "elaboratedBy" TEXT,
    "reviewedBy" TEXT,
    "approvedBy" TEXT,
    "changeLog" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_formats_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "procedures" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "scope" TEXT,
    "responsible" TEXT,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "pendingValidation" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "procedures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID,
    "username" TEXT,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" BIGSERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL,
    "finishedAt" TIMESTAMPTZ(6),
    "fileName" TEXT,
    "sizeBytes" BIGINT,
    "sha256" TEXT,
    "status" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifyMessage" TEXT,
    "restoreTested" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_roleId_idx" ON "users"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "login_attempts_username_createdAt_idx" ON "login_attempts"("username", "createdAt");

-- CreateIndex
CREATE INDEX "login_attempts_ip_createdAt_idx" ON "login_attempts"("ip", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "areas_code_key" ON "areas"("code");

-- CreateIndex
CREATE UNIQUE INDEX "areas_name_key" ON "areas"("name");

-- CreateIndex
CREATE UNIQUE INDEX "locations_code_key" ON "locations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "asset_categories_code_key" ON "asset_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "asset_categories_name_key" ON "asset_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "asset_subcategories_categoryId_name_key" ON "asset_subcategories"("categoryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "assets_code_key" ON "assets"("code");

-- CreateIndex
CREATE INDEX "assets_categoryId_idx" ON "assets"("categoryId");

-- CreateIndex
CREATE INDEX "assets_areaId_idx" ON "assets"("areaId");

-- CreateIndex
CREATE INDEX "assets_status_idx" ON "assets"("status");

-- CreateIndex
CREATE INDEX "assets_criticality_idx" ON "assets"("criticality");

-- CreateIndex
CREATE INDEX "asset_status_history_assetId_createdAt_idx" ON "asset_status_history"("assetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "criticality_criteria_code_key" ON "criticality_criteria"("code");

-- CreateIndex
CREATE INDEX "criticality_assessments_assetId_assessedAt_idx" ON "criticality_assessments"("assetId", "assessedAt");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_nit_key" ON "suppliers"("nit");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_number_key" ON "contracts"("number");

-- CreateIndex
CREATE INDEX "contracts_endDate_idx" ON "contracts"("endDate");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_programs_code_key" ON "maintenance_programs"("code");

-- CreateIndex
CREATE INDEX "maintenance_programs_assetId_idx" ON "maintenance_programs"("assetId");

-- CreateIndex
CREATE INDEX "maintenance_programs_isActive_idx" ON "maintenance_programs"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "annual_plans_year_key" ON "annual_plans"("year");

-- CreateIndex
CREATE INDEX "annual_plan_events_planId_createdAt_idx" ON "annual_plan_events"("planId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "annual_plan_versions_planId_version_key" ON "annual_plan_versions"("planId", "version");

-- CreateIndex
CREATE INDEX "scheduled_activities_planId_committedDate_idx" ON "scheduled_activities"("planId", "committedDate");

-- CreateIndex
CREATE INDEX "scheduled_activities_assetId_idx" ON "scheduled_activities"("assetId");

-- CreateIndex
CREATE INDEX "scheduled_activities_status_idx" ON "scheduled_activities"("status");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_activities_planId_programId_periodKey_key" ON "scheduled_activities"("planId", "programId", "periodKey");

-- CreateIndex
CREATE INDEX "reschedules_activityId_idx" ON "reschedules"("activityId");

-- CreateIndex
CREATE INDEX "reschedules_status_idx" ON "reschedules"("status");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_code_key" ON "work_orders"("code");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_activityId_key" ON "work_orders"("activityId");

-- CreateIndex
CREATE INDEX "work_orders_status_idx" ON "work_orders"("status");

-- CreateIndex
CREATE INDEX "work_orders_assetId_idx" ON "work_orders"("assetId");

-- CreateIndex
CREATE INDEX "work_orders_type_status_idx" ON "work_orders"("type", "status");

-- CreateIndex
CREATE INDEX "work_orders_assignedToId_idx" ON "work_orders"("assignedToId");

-- CreateIndex
CREATE INDEX "work_orders_createdAt_idx" ON "work_orders"("createdAt");

-- CreateIndex
CREATE INDEX "work_order_events_workOrderId_createdAt_idx" ON "work_order_events"("workOrderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "failure_reports_code_key" ON "failure_reports"("code");

-- CreateIndex
CREATE INDEX "failure_reports_status_idx" ON "failure_reports"("status");

-- CreateIndex
CREATE INDEX "failure_reports_priority_status_idx" ON "failure_reports"("priority", "status");

-- CreateIndex
CREATE INDEX "failure_reports_assetId_reportedAt_idx" ON "failure_reports"("assetId", "reportedAt");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storedName_key" ON "documents"("storedName");

-- CreateIndex
CREATE INDEX "documents_assetId_idx" ON "documents"("assetId");

-- CreateIndex
CREATE INDEX "documents_workOrderId_idx" ON "documents"("workOrderId");

-- CreateIndex
CREATE INDEX "documents_failureReportId_idx" ON "documents"("failureReportId");

-- CreateIndex
CREATE INDEX "documents_type_idx" ON "documents"("type");

-- CreateIndex
CREATE UNIQUE INDEX "procedures_code_key" ON "procedures"("code");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_module_action_idx" ON "audit_logs"("module", "action");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "backup_runs_startedAt_idx" ON "backup_runs"("startedAt");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "permissions"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_areas" ADD CONSTRAINT "user_areas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_areas" ADD CONSTRAINT "user_areas_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_subcategories" ADD CONSTRAINT "asset_subcategories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "asset_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "asset_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "asset_subcategories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_status_history" ADD CONSTRAINT "asset_status_history_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "criticality_assessments" ADD CONSTRAINT "criticality_assessments_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_assets" ADD CONSTRAINT "contract_assets_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_assets" ADD CONSTRAINT "contract_assets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_evaluations" ADD CONSTRAINT "supplier_evaluations_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_programs" ADD CONSTRAINT "maintenance_programs_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_programs" ADD CONSTRAINT "maintenance_programs_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "asset_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_programs" ADD CONSTRAINT "maintenance_programs_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_programs" ADD CONSTRAINT "maintenance_programs_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annual_plan_events" ADD CONSTRAINT "annual_plan_events_planId_fkey" FOREIGN KEY ("planId") REFERENCES "annual_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annual_plan_versions" ADD CONSTRAINT "annual_plan_versions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "annual_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_activities" ADD CONSTRAINT "scheduled_activities_planId_fkey" FOREIGN KEY ("planId") REFERENCES "annual_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_activities" ADD CONSTRAINT "scheduled_activities_programId_fkey" FOREIGN KEY ("programId") REFERENCES "maintenance_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_activities" ADD CONSTRAINT "scheduled_activities_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_activities" ADD CONSTRAINT "scheduled_activities_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedules" ADD CONSTRAINT "reschedules_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "scheduled_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "scheduled_activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_failureReportId_fkey" FOREIGN KEY ("failureReportId") REFERENCES "failure_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_parentWorkOrderId_fkey" FOREIGN KEY ("parentWorkOrderId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_parts" ADD CONSTRAINT "work_order_parts_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failure_reports" ADD CONSTRAINT "failure_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failure_reports" ADD CONSTRAINT "failure_reports_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failure_reports" ADD CONSTRAINT "failure_reports_releaseAuthorizedById_fkey" FOREIGN KEY ("releaseAuthorizedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failure_reports" ADD CONSTRAINT "failure_reports_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failure_reports" ADD CONSTRAINT "failure_reports_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failure_reports" ADD CONSTRAINT "failure_reports_resolvedByWorkOrderId_fkey" FOREIGN KEY ("resolvedByWorkOrderId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_failureReportId_fkey" FOREIGN KEY ("failureReportId") REFERENCES "failure_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_planId_fkey" FOREIGN KEY ("planId") REFERENCES "annual_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
