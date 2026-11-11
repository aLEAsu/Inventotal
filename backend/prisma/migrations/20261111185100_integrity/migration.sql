-- =============================================================
-- Reglas de integridad adicionales (no expresables en Prisma)
-- =============================================================

-- 1. Bitácora de auditoría inmutable: se bloquea UPDATE / DELETE / TRUNCATE
CREATE OR REPLACE FUNCTION sigm_block_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La bitácora de auditoría es inmutable (operación % no permitida)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION sigm_block_audit_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION sigm_block_audit_mutation();

-- 2. Historiales de eventos inmutables
CREATE TRIGGER wo_events_no_update BEFORE UPDATE OR DELETE ON work_order_events
  FOR EACH ROW EXECUTE FUNCTION sigm_block_audit_mutation();
CREATE TRIGGER plan_events_no_update BEFORE UPDATE OR DELETE ON annual_plan_events
  FOR EACH ROW EXECUTE FUNCTION sigm_block_audit_mutation();
CREATE TRIGGER plan_versions_no_update BEFORE UPDATE OR DELETE ON annual_plan_versions
  FOR EACH ROW EXECUTE FUNCTION sigm_block_audit_mutation();
CREATE TRIGGER asset_status_hist_no_update BEFORE UPDATE OR DELETE ON asset_status_history
  FOR EACH ROW EXECUTE FUNCTION sigm_block_audit_mutation();

-- 3. No se eliminan físicamente activos con historial
CREATE OR REPLACE FUNCTION sigm_block_asset_delete() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM work_orders WHERE "assetId" = OLD.id)
     OR EXISTS (SELECT 1 FROM scheduled_activities WHERE "assetId" = OLD.id)
     OR EXISTS (SELECT 1 FROM failure_reports WHERE "assetId" = OLD.id) THEN
    RAISE EXCEPTION 'El activo % tiene historial de mantenimiento: use baja lógica', OLD.code
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER assets_no_delete_with_history BEFORE DELETE ON assets
  FOR EACH ROW EXECUTE FUNCTION sigm_block_asset_delete();

-- 4. Las órdenes, fallas y actividades no se borran
CREATE OR REPLACE FUNCTION sigm_block_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'No se permite eliminar registros de % (use cancelación/anulación)', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER work_orders_no_delete BEFORE DELETE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION sigm_block_delete();
CREATE TRIGGER failure_reports_no_delete BEFORE DELETE ON failure_reports
  FOR EACH ROW EXECUTE FUNCTION sigm_block_delete();
CREATE TRIGGER scheduled_activities_no_delete BEFORE DELETE ON scheduled_activities
  FOR EACH ROW EXECUTE FUNCTION sigm_block_delete();
CREATE TRIGGER reschedules_no_delete BEFORE DELETE ON reschedules
  FOR EACH ROW EXECUTE FUNCTION sigm_block_delete();
CREATE TRIGGER annual_plans_no_delete BEFORE DELETE ON annual_plans
  FOR EACH ROW EXECUTE FUNCTION sigm_block_delete();

-- 5. Fecha original inmutable una vez la actividad pertenece a una versión aprobada
CREATE OR REPLACE FUNCTION sigm_protect_original_date() RETURNS trigger AS $$
BEGIN
  IF NEW."originalDate" IS DISTINCT FROM OLD."originalDate" THEN
    IF EXISTS (SELECT 1 FROM annual_plans p WHERE p.id = OLD."planId" AND p.status IN ('APROBADO','CERRADO')) THEN
      RAISE EXCEPTION 'La fecha originalmente aprobada no puede modificarse'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER scheduled_activities_protect_original BEFORE UPDATE ON scheduled_activities
  FOR EACH ROW EXECUTE FUNCTION sigm_protect_original_date();

-- 6. Restricciones de dominio
ALTER TABLE annual_plans ADD CONSTRAINT annual_plans_year_chk CHECK (year BETWEEN 2000 AND 2100);
ALTER TABLE work_orders ADD CONSTRAINT work_orders_costs_chk CHECK ("laborCost" >= 0 AND "externalCost" >= 0 AND "partsCost" >= 0 AND "totalCost" >= 0);
ALTER TABLE work_orders ADD CONSTRAINT work_orders_dates_chk CHECK ("finishedAt" IS NULL OR "startedAt" IS NULL OR "finishedAt" >= "startedAt");
ALTER TABLE work_orders ADD CONSTRAINT work_orders_cancel_reason_chk CHECK (status <> 'CANCELADA' OR ("cancelReason" IS NOT NULL AND length(trim("cancelReason")) >= 5));
ALTER TABLE work_order_parts ADD CONSTRAINT wo_parts_chk CHECK (quantity > 0 AND "unitCost" >= 0);
ALTER TABLE failure_reports ADD CONSTRAINT failure_downtime_chk CHECK ("downtimeEnd" IS NULL OR "downtimeStart" IS NULL OR "downtimeEnd" >= "downtimeStart");
ALTER TABLE maintenance_programs ADD CONSTRAINT programs_interval_chk CHECK ("frequencyType" <> 'PERSONALIZADO' OR ("intervalValue" > 0 AND "intervalUnit" IS NOT NULL));
ALTER TABLE maintenance_programs ADD CONSTRAINT programs_dates_chk CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE contracts ADD CONSTRAINT contracts_dates_chk CHECK ("endDate" >= "startDate");
ALTER TABLE reschedules ADD CONSTRAINT reschedules_reason_chk CHECK (length(trim(reason)) >= 10);
ALTER TABLE criticality_criteria ADD CONSTRAINT criteria_weight_chk CHECK (weight >= 0 AND weight <= 100 AND "maxScore" >= 2);
