# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

# --- deps: instala dependencias del workspace completo (cache-friendly) ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma ./apps/api/prisma
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

# --- dev: hot-reload montando el código como volumen (ver docker-compose.override.yml) ---
FROM deps AS dev
COPY . .
WORKDIR /repo/apps/api
EXPOSE 4000
# El volumen anónimo /repo/node_modules persiste entre reinicios y no se
# entera de cambios en schema.prisma. `prisma generate` al arrancar
# sincroniza el Prisma Client con el schema actual antes de compilar.
CMD ["sh", "-c", "npx prisma generate && pnpm dev"]

# --- build: compila el paquete api a dist/ ---
FROM deps AS build
COPY . .
RUN pnpm --filter @edgeiq/api build
RUN pnpm --filter @edgeiq/api deploy --prod /prod/api

# --- prod: imagen final, solo runtime ---
FROM base AS prod
ENV NODE_ENV=production
COPY --from=build /prod/api ./
EXPOSE 4000
# `pnpm deploy --prod` (stage build) no copia el Prisma Client generado —
# vive en una ubicación "hoisted" del store de pnpm que el paquete aislado
# no hereda. Regenerarlo acá es más simple que pelear con pnpm deploy, y
# migrate deploy aplica migraciones pendientes (necesario en el primer
# deploy contra una base de datos nueva, ej. Railway).
CMD ["sh", "-c", "npx prisma generate && npx prisma migrate deploy && node dist/main.js"]
