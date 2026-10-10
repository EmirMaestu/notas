# syntax=docker/dockerfile:1
# Imagen de producción de Notas (Next.js standalone). Se construye en la VPS vía deploy/docker-compose.yml.
# Debian (glibc) y no Alpine: package-lock.json trae los binarios nativos linux-x64-gnu de swc, tailwind
# (oxide, lightningcss) y sharp, así que npm ci no depende de variantes musl.
ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Necesita red: next/font/google descarga Inter durante el build.
RUN npm run build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# getDb() aplica las migraciones desde ./drizzle al arrancar (el standalone ya las trae; esto lo hace explícito).
COPY --from=build --chown=node:node /app/drizzle ./drizzle
USER node
EXPOSE 3000
# La imagen slim no trae curl: el chequeo usa el fetch de Node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
