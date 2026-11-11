#!/bin/sh
# =============================================================================
# SIGM — Respaldo verificado de PostgreSQL y de documentos/evidencias
#  - pg_dump en formato personalizado (-Fc)
#  - Verificación: el archivo existe, supera un tamaño mínimo coherente y su
#    catálogo es legible con pg_restore --list. Se calcula SHA-256.
#  - Prueba de restauración periódica en una base temporal aislada.
#  - Respaldo de documentos (tar.gz) con verificación de integridad.
#  - Retención configurable (RETENTION_DAYS, por defecto 30).
#  - Cada ejecución queda registrada en la tabla backup_runs.
# Un respaldo NO se considera exitoso solo porque el comando terminó sin error.
# =============================================================================
set -u
: "${PGHOST:?}" "${PGUSER:?}" "${PGDATABASE:?}" "${PGPASSWORD:?}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
STORAGE_DIR="${STORAGE_DIR:-/storage}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
MIN_DB_BYTES="${MIN_DB_BYTES:-20000}"
RESTORE_TEST="${RESTORE_TEST:-weekly}"   # always | weekly | never
TS="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/files" "$BACKUP_DIR/logs"
LOG="$BACKUP_DIR/logs/backup_$TS.log"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] $*" | tee -a "$LOG"; }
sqlq() { printf "%s" "$1" | sed "s/'/''/g"; }

record() { # kind start file size sha status verified verifyMsg restoreTested message
  psql -v ON_ERROR_STOP=1 -q -c "INSERT INTO backup_runs (kind, \"startedAt\", \"finishedAt\", \"fileName\", \"sizeBytes\", sha256, status, verified, \"verifyMessage\", \"restoreTested\", message)
    VALUES ('$1', '$2', now(), NULLIF('$(sqlq "$3")',''), NULLIF('$4','')::bigint, NULLIF('$5',''), '$6', $7, '$(sqlq "$8")', $9, '$(sqlq "${10}")')" >>"$LOG" 2>&1 \
    || log "ADVERTENCIA: no se pudo registrar el resultado en backup_runs"
}

# ------------------------------------------------------------------ Base de datos
START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DB_FILE="$BACKUP_DIR/db/sigm_${PGDATABASE}_$TS.dump"
log "Iniciando respaldo de la base $PGDATABASE en $DB_FILE"
STATUS=OK; VERIFIED=false; MSG=""; RESTORED=false; SIZE=""; SHA=""
if ! pg_dump -Fc -Z 6 -f "$DB_FILE" >>"$LOG" 2>&1; then
  STATUS=ERROR; MSG="pg_dump falló"
fi
if [ "$STATUS" = OK ]; then
  if [ ! -s "$DB_FILE" ]; then STATUS=ERROR; MSG="El archivo de respaldo no existe o está vacío"
  else
    SIZE=$(stat -c %s "$DB_FILE")
    SHA=$(sha256sum "$DB_FILE" | cut -d' ' -f1)
    if [ "$SIZE" -lt "$MIN_DB_BYTES" ]; then STATUS=ERROR; MSG="Tamaño incoherente ($SIZE bytes < $MIN_DB_BYTES)"
    elif ! pg_restore --list "$DB_FILE" >/dev/null 2>>"$LOG"; then STATUS=ERROR; MSG="pg_restore no puede leer el catálogo del respaldo"
    else
      TABLES=$(pg_restore --list "$DB_FILE" | grep -c "TABLE DATA")
      VERIFIED=true; MSG="Catálogo legible ($TABLES tablas con datos)"
      echo "$SHA  $(basename "$DB_FILE")" > "$DB_FILE.sha256"
    fi
  fi
fi

# Prueba de restauración en base aislada (semanal los domingos, o siempre)
DO_RESTORE=false
[ "$RESTORE_TEST" = always ] && DO_RESTORE=true
[ "$RESTORE_TEST" = weekly ] && [ "$(date +%u)" = 7 ] && DO_RESTORE=true
if [ "$STATUS" = OK ] && [ "$DO_RESTORE" = true ]; then
  TEST_DB="sigm_restore_test"
  log "Prueba de restauración en $TEST_DB"
  psql -d postgres -q -c "DROP DATABASE IF EXISTS $TEST_DB WITH (FORCE)" >>"$LOG" 2>&1
  if psql -d postgres -q -c "CREATE DATABASE $TEST_DB" >>"$LOG" 2>&1 \
     && pg_restore --no-owner --exit-on-error -d "$TEST_DB" "$DB_FILE" >>"$LOG" 2>&1; then
    ORIG=$(psql -tAc "SELECT count(*) FROM audit_logs")
    REST=$(psql -d "$TEST_DB" -tAc "SELECT count(*) FROM audit_logs")
    ASSETS=$(psql -d "$TEST_DB" -tAc "SELECT count(*) FROM assets")
    if [ -n "$REST" ] && [ "$REST" -le "$ORIG" ] && [ "$REST" -gt 0 ]; then
      RESTORED=true; MSG="$MSG; restauración de prueba OK (auditoría $REST registros, activos $ASSETS)"
    else
      STATUS=ERROR; MSG="$MSG; restauración de prueba inconsistente (auditoría original $ORIG / restaurada $REST)"
    fi
  else
    STATUS=ERROR; MSG="$MSG; la restauración de prueba falló"
  fi
  psql -d postgres -q -c "DROP DATABASE IF EXISTS $TEST_DB WITH (FORCE)" >>"$LOG" 2>&1
fi
log "Base de datos: $STATUS — $MSG"
record DB "$START" "$(basename "$DB_FILE")" "$SIZE" "$SHA" "$STATUS" "$VERIFIED" "$MSG" "$RESTORED" "Respaldo programado"

# ------------------------------------------------------------------ Documentos
START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
F_FILE="$BACKUP_DIR/files/sigm_documentos_$TS.tar.gz"
F_STATUS=OK; F_VER=false; F_MSG=""; F_SIZE=""; F_SHA=""
if [ -d "$STORAGE_DIR" ]; then
  if tar -czf "$F_FILE" -C "$STORAGE_DIR" . 2>>"$LOG" && [ -s "$F_FILE" ]; then
    F_SIZE=$(stat -c %s "$F_FILE"); F_SHA=$(sha256sum "$F_FILE" | cut -d' ' -f1)
    COUNT_SRC=$(find "$STORAGE_DIR" -type f | wc -l)
    COUNT_TAR=$(tar -tzf "$F_FILE" 2>>"$LOG" | grep -vc '/$')
    if [ "$COUNT_TAR" -eq "$COUNT_SRC" ]; then F_VER=true; F_MSG="Archivo íntegro ($COUNT_TAR archivos)"; echo "$F_SHA  $(basename "$F_FILE")" > "$F_FILE.sha256"
    else F_STATUS=ERROR; F_MSG="Conteo inconsistente (origen $COUNT_SRC / respaldo $COUNT_TAR)"; fi
  else F_STATUS=ERROR; F_MSG="No se pudo generar el archivo de documentos"; fi
else F_STATUS=ERROR; F_MSG="Directorio de documentos no disponible ($STORAGE_DIR)"; fi
log "Documentos: $F_STATUS — $F_MSG"
record FILES "$START" "$(basename "$F_FILE")" "$F_SIZE" "$F_SHA" "$F_STATUS" "$F_VER" "$F_MSG" false "Respaldo programado"

# ------------------------------------------------------------------ Retención
find "$BACKUP_DIR/db" "$BACKUP_DIR/files" "$BACKUP_DIR/logs" -type f -mtime +"$RETENTION_DAYS" -print -delete >>"$LOG" 2>&1
log "Retención aplicada: $RETENTION_DAYS días"
[ "$STATUS" = OK ] && [ "$F_STATUS" = OK ]
