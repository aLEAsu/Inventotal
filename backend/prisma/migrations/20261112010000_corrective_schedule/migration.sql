-- Cronograma correctivo: mantenimientos correctivos planificados por grupo o equipo
ALTER TYPE "MaintenanceKind" ADD VALUE IF NOT EXISTS 'CORRECTIVO' AFTER 'PREVENTIVO';
