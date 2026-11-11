#!/bin/sh
# Aplica migraciones versionadas y la semilla BASE (idempotente) antes de iniciar la API.
# Nunca carga datos de demostración en producción.
set -e
echo "[sigm] Aplicando migraciones..."
npx prisma migrate deploy
echo "[sigm] Aplicando configuración base (idempotente)..."
node dist-tools/prisma/seed.js
exec "$@"
