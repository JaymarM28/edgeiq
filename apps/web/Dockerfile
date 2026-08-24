# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

# --- deps ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma ./apps/api/prisma
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

# --- dev: hot-reload montando el código como volumen ---
FROM deps AS dev
COPY . .
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["pnpm", "dev"]

# --- build ---
FROM deps AS build
COPY . .
RUN pnpm --filter @edgeiq/web build

# --- prod: usa la salida standalone de Next.js ---
FROM base AS prod
ENV NODE_ENV=production
WORKDIR /repo/apps/web
COPY --from=build /repo/apps/web/public ./public
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
