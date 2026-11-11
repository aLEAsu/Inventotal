# SIGM — compilación del frontend y servidor Nginx (proxy inverso + HTTPS)
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild esbuild
COPY . .
RUN npx vite build

FROM nginx:1.29-alpine
ENV TZ=America/Bogota
RUN apk add --no-cache openssl tzdata
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx/certs-entrypoint.sh /docker-entrypoint.d/05-certs.sh
RUN sed -i 's/\r$//' /docker-entrypoint.d/05-certs.sh && chmod +x /docker-entrypoint.d/05-certs.sh
EXPOSE 80 443
