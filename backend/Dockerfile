# SIGM API — imagen de producción (Node.js 24 LTS)
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild @prisma/engines prisma
COPY prisma.config.ts tsconfig.json tsconfig.build.json tsconfig.tools.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
RUN DATABASE_URL=postgresql://x:x@localhost:5432/x npx prisma generate && npx nest build && npx tsc -p tsconfig.tools.json

FROM node:24-alpine AS runtime
ENV NODE_ENV=production TZ=America/Bogota
RUN apk add --no-cache tzdata && addgroup -S sigm && adduser -S sigm -G sigm
WORKDIR /app
COPY package.json package-lock.json ./
# Dependencias de producción + CLI de Prisma (migraciones). Los scripts administrativos van compilados (dist-tools).
RUN npm ci --omit=dev --ignore-scripts && npm i --no-save --ignore-scripts prisma@7.10.1 && npm rebuild @prisma/engines prisma && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-tools ./dist-tools
COPY --from=build /app/src/generated ./src/generated
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data/storage && chown -R sigm:sigm /data /app
USER sigm
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD wget -qO- http://127.0.0.1:3000/api/v1/health || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
