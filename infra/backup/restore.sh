#!/bin/sh
# =============================================================================
# SIGM — Restauración de un respaldo
#   restore.sh <archivo.dump> <base_destino> [archivo_documentos.tar.gz]
# - Verifica el SHA-256 si existe el archivo .sha256 junto al respaldo.
# - Restaura en la base indicada (se crea si no existe). NO restaura sobre una base
#   con datos salvo que se defina FORCE=1 (para evitar sobrescrituras accidentales).
# - Opcionalmente restaura los documentos en $STORAGE_DIR.
# =============================================================================
set -eu
DUMP="${1:?Indique el archivo .dump}"
TARGET="${2:?Indique la base de datos destino}"
FILES="${3:-}"
[ -s "$DUMP" ] || { echo "El respaldo no existe o está vacío: $DUMP"; exit 1; }
if [ -f "$DUMP.sha256" ]; then
  (cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256") || { echo "SHA-256 no coincide: respaldo corrupto"; exit 1; }
fi
pg_restore --list "$DUMP" >/dev/null
EXISTS=$(psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$TARGET'")
if [ "$EXISTS" = 1 ]; then
  HAS=$(psql -d "$TARGET" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
  if [ "$HAS" != 0 ] && [ "${FORCE:-0}" != 1 ]; then
    echo "La base $TARGET ya contiene tablas. Use FORCE=1 para reemplazarla (se recomienda restaurar en una base nueva y luego cambiar DATABASE_URL)."
    exit 1
  fi
  [ "${FORCE:-0}" = 1 ] && psql -d postgres -c "DROP DATABASE $TARGET WITH (FORCE)" && psql -d postgres -c "CREATE DATABASE $TARGET"
else
  psql -d postgres -c "CREATE DATABASE $TARGET"
fi
pg_restore --no-owner --exit-on-error -d "$TARGET" "$DUMP"
echo "Base restaurada en $TARGET:"
psql -d "$TARGET" -tAc "SELECT 'activos: '||count(*) FROM assets UNION ALL SELECT 'actividades: '||count(*) FROM scheduled_activities UNION ALL SELECT 'órdenes: '||count(*) FROM work_orders UNION ALL SELECT 'auditoría: '||count(*) FROM audit_logs"
if [ -n "$FILES" ]; then
  : "${STORAGE_DIR:?Defina STORAGE_DIR para restaurar documentos}"
  [ -f "$FILES.sha256" ] && (cd "$(dirname "$FILES")" && sha256sum -c "$(basename "$FILES").sha256")
  mkdir -p "$STORAGE_DIR" && tar -xzf "$FILES" -C "$STORAGE_DIR"
  echo "Documentos restaurados en $STORAGE_DIR ($(find "$STORAGE_DIR" -type f | wc -l) archivos)"
fi
