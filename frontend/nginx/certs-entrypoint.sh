#!/bin/sh
# Si no se montaron certificados institucionales, genera uno autofirmado temporal
# (solo para pruebas en red interna; en producción monte los certificados de la institución en /etc/nginx/certs).
set -e
mkdir -p /etc/nginx/certs
if [ ! -f /etc/nginx/certs/sigm.crt ] || [ ! -f /etc/nginx/certs/sigm.key ]; then
  echo "[sigm] Certificado no encontrado: generando certificado autofirmado temporal"
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout /etc/nginx/certs/sigm.key -out /etc/nginx/certs/sigm.crt \
    -subj "/CN=${SIGM_HOSTNAME:-sigm.local}" >/dev/null 2>&1
fi
cat > /etc/nginx/conf.d/proxy_params.inc <<'EOF'
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
EOF
