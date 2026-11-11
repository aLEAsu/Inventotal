# Servicio de respaldo: cliente PostgreSQL 18 + cron (BusyBox)
FROM postgres:18-alpine
ENV TZ=America/Bogota
RUN apk add --no-cache tzdata
COPY backup.sh restore.sh /usr/local/bin/
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/backup.sh /usr/local/bin/restore.sh /entrypoint.sh && chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
