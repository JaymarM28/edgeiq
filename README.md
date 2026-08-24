# EdgeIQ

Plataforma personal de análisis deportivo con IA. Prioriza simplicidad, bajo costo, calidad y escalabilidad (ver `docs/PROJECT_CONTEXT.md`).

## Estado

Paso 1 del roadmap (Arquitectura) completado: scaffold del monorepo. Sin lógica de negocio todavía — ver `docs/TODO.md` y `docs/ROADMAP.md` para los próximos pasos.

## Estructura

```
apps/api        NestJS — monolito modular, un módulo por dominio (leagues, teams, matches, players, odds, predictions, results, notifications, users)
apps/web        Next.js + Tailwind + shadcn/ui
packages/shared Tipos/DTOs compartidos entre api y web
docs/           Documentación de arquitectura, stack, decisiones, roadmap
```

## Requisitos

- Node.js 20+
- pnpm 9 (`corepack enable`)
- Docker + Docker Compose (opcional, recomendado para levantar Postgres/Redis)

## Desarrollo local

```bash
cp .env.example .env
pnpm install
docker compose up          # levanta postgres, redis, api (puerto 4000) y web (puerto 3000) con hot-reload
```

Sin Docker, alternativamente:

```bash
pnpm install
pnpm --filter @edgeiq/api dev   # http://localhost:4000  (Swagger en /docs)
pnpm --filter @edgeiq/web dev   # http://localhost:3000
```

## Producción

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## Documentación

Toda la documentación de referencia (arquitectura, stack, decisiones, roadmap, estándares) vive en `docs/`. Las decisiones técnicas se registran con fecha, motivo y alternativas en `docs/DECISIONS.md`.
