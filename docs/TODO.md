# TODO

- [x] Paso 1 (Arquitectura): scaffold del monorepo (apps/api, apps/web, packages/shared, Docker Compose dev/prod)
- [x] Paso 2 (DB): esquema Prisma (League, Team, Match, Player, Odds, Prediction, Result, Notification, User)
- [x] Elegir APIs de datos deportivos / odds → API-Football, **plan Pro** ($19/mes, 7 500 req/día — se hizo upgrade porque el plan Free no da acceso a la temporada actual)
- [x] Paso 3 (Ingesta): módulo `core/integrations/api-football` + `domain/ingestion` (upsert Prisma, endpoint manual con `?season=`, job BullMQ diario)
- [x] Paso 4 (Modelos): Poisson, Elo, Expected Value en `domain/predictions` — `POST /v1/predictions/generate`, `GET /v1/predictions/value-bets`
- [x] Confirmar `API_FOOTBALL_LEAGUE_ID` → 39 = Premier League, confirmado
- [x] Correr `pnpm install`, `docker compose up`, `prisma migrate dev` — verificado en la máquina del usuario (varios bugs de Docker corregidos en el camino, ver docs/DECISIONS.md)
- [x] Probar `POST /v1/ingestion/sync` contra la API real — 380 fixtures temporada 2026 + 380 de 2025 (historial para Poisson/Elo)
- [x] Probar `POST /v1/predictions/generate` — 380/380 generadas (Poisson + Elo)
- [x] Probar `GET /v1/predictions/value-bets` — responde vacío correctamente: próximo partido es el 21 de agosto y las casas de apuestas todavía no publican cuotas tan lejos. Se resuelve solo cuando se acerque la fecha (el job diario ya está armado para eso).
- [ ] Backtesting de Poisson vs Elo una vez haya historial suficiente (docs/LEARNINGS.md)
- [ ] Definir estrategia de autenticación de User (no bloqueante, pero pendiente; también protegería los endpoints de sync/generate)
- [ ] Paso 5 (Dashboard) y Paso 6 (Notificaciones)
- [ ] Explicación del LLM sobre las predicciones (docs/DECISION_ENGINE.md) — no está en el roadmap todavía, evaluar cuándo entra
- [ ] Crear MVP
