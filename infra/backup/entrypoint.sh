#!/bin/sh
# Programa el respaldo diario (BACKUP_CRON, por defecto 02:00 hora de Bogotá) y mantiene el contenedor activo.
set -e
CRON="${BACKUP_CRON:-0 2 * * *}"
env | grep -E '^(PG|BACKUP_|STORAGE_DIR|RETENTION_DAYS|RESTORE_TEST|MIN_DB_BYTES|TZ)' | sed 's/^/export /; s/=\(.*\)$/="\1"/' > /etc/backup.env
echo "$CRON . /etc/backup.env; /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
echo "[sigm-backup] Respaldo programado: '$CRON' (TZ=$TZ, retención ${RETENTION_DAYS:-30} días)"
exec crond -f -l 6
