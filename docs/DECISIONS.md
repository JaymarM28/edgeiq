# Decisiones

Registrar cada decisión técnica con fecha, motivo y alternativas.

## 2026-08-06 — Tooling de monorepo: pnpm workspaces

**Decisión:** usar pnpm workspaces (sin Turborepo/Nx) para orquestar `apps/api`, `apps/web` y `packages/shared`.

**Motivo:** PROJECT_CONTEXT.md prioriza simplicidad. Con solo dos apps, Turborepo/Nx añaden configuración (pipelines, caching) sin beneficio claro todavía.

**Alternativas consideradas:**
- Turborepo — descartado por ahora; revalorar si los tiempos de build se vuelven un problema.
- Repos separados — descartado porque complica compartir DTOs/tipos entre `api` y `web` (contradice DECISION_ENGINE.md y API_GUIDELINES.md, que dependen de contratos compartidos).

## 2026-08-06 — Docker Compose también para producción

**Decisión:** un único `docker-compose.yml` base + `docker-compose.override.yml` (dev, auto-cargado) + `docker-compose.prod.yml` (prod, explícito vía `-f`). Dockerfiles multi-stage (`dev`/`build`/`prod`) en `apps/api` y `apps/web`.

**Motivo:** evita mantener dos formas de construir las imágenes y deja el mismo Dockerfile válido para dev (hot-reload por volumen) y prod (build optimizado, `pnpm deploy` para el API, `output: standalone` para Next.js).

**Alternativas consideradas:**
- Compose solo para dev, decidir infraestructura de prod más adelante (Kubernetes, PaaS, etc.) — descartado por ahora porque el proyecto es de escala personal; un VPS con Compose es suficiente y más barato. Puede revisitarse si el uso crece.

**Pendiente relacionado:** aún no se define reverse proxy / TLS para producción (no bloqueante para el Paso 1 de arquitectura).

## 2026-08-06 — Paso 1 del roadmap (Arquitectura): estructura del scaffold

**Decisión:** monorepo con `apps/api` (NestJS, monolito modular con un módulo por entidad de dominio: leagues, teams, matches, players, odds, predictions, results, notifications, users), `apps/web` (Next.js + Tailwind + shadcn/ui sobre Radix UI), `packages/shared` (tipos/DTOs compartidos, aún vacío). Prisma inicializado solo con datasource/generator (sin modelos — eso es el Paso 2, Diseño de esquema). API con versionado `/v1`, Swagger en `/docs`, `ValidationPipe` global y filtro de excepciones para errores consistentes, conforme a API_GUIDELINES.md.

**Motivo:** ejecutar el Paso 1 del ROADMAP.md sin adelantar decisiones de los pasos siguientes (esquema de datos, ingesta, modelos).

**Alternativas consideradas:** ninguna alternativa arquitectónica — se respetan las decisiones ya registradas en ARCHITECTURE.md y STACK.md.

## 2026-08-06 — Paso 2 del roadmap (DB): esquema Prisma

**Decisión:** `apps/api/prisma/schema.prisma` con las 9 entidades de DATABASE.md (League, Team, Match, Player, Odds, Prediction, Result, Notification, User). Puntos de diseño no triviales:
- `Team` no queda atado a una `League` fija; la relación real ocurre vía `Match` (home/away). Evita modelar Season/Standing, que el roadmap no pide todavía.
- `Odds` es una serie temporal (una fila por lectura, con `fetchedAt`), no un valor mutable — necesario para medir movimiento de línea y para el backtesting de LEARNINGS.md.
- `market`/`selection` en `Odds`/`Prediction` quedan como `String` en vez de enum, porque cada proveedor de datos tipifica los mercados distinto y "Elegir APIs" sigue sin resolverse.
- `Result` se mantiene como entidad separada de `Match` (1:1), tal como lo define DATABASE.md, para distinguir lo programado de lo ocurrido.
- `User` queda con `passwordHash` nullable y sin proveedor de auth definido — no bloquea el esquema, pero es una decisión pendiente.
- IDs con `cuid()` en vez de autoincremental o `uuid()` — convención por defecto de Prisma, evita filtrar volumen de filas y es más corto que un UUID.

**Motivo:** ejecutar el Paso 2 del ROADMAP.md sin adelantar la Fase 3 (Ingesta), que depende de elegir el proveedor de datos.

**Verificación:** no fue posible correr `prisma validate`/`generate` en este entorno (el sandbox bloquea la descarga del motor de Prisma desde `binaries.prisma.sh`, error 403). Se revisó la sintaxis manualmente; se ejecutará automáticamente vía `postinstall` en cuanto se corra `pnpm install` con acceso real a internet.

**Pendiente relacionado:** "Elegir APIs" sigue bloqueando el Paso 3 (Ingesta). Estrategia de autenticación de `User` sin definir.

## 2026-08-06 — Proveedor de datos: API-Football (API-Sports), plan Free

**Decisión:** usar [API-Football](https://www.api-football.com/) como proveedor único para fixtures, equipos, jugadores y odds (pre-match y live), empezando en el plan Free (100 requests/día, todas las ligas y endpoints, sin tarjeta).

**Motivo:** un solo proveedor para datos deportivos + odds reduce la superficie de ingesta a una sola integración/clave, alineado con la prioridad de simplicidad de PROJECT_CONTEXT.md. El plan Free permite validar el pipeline completo (ingesta → predicción → value bet) antes de comprometer presupuesto.

**Alternativas consideradas:**
- Split Sportmonks/football-data.org (fixtures) + The Odds API (odds, ~40 bookmakers) — mejor cobertura de odds para comparar líneas y afinar la detección de value bets, pero dos integraciones y dos claves, y el free tier de The Odds API es muy limitado (~500 créditos/mes, ~16 requests/día). Se descarta por ahora; revalorar si la calidad/cobertura de odds de API-Football resulta insuficiente.
- Datos mock sin proveedor real — descartado porque ya hay presupuesto/tiempo para integrar un proveedor real desde el Paso 3.

**Impacto:** el Paso 3 (Ingesta) se diseña contra la API de API-Football. Límite de 100 requests/día del plan Free condiciona cuántas ligas/partidos se pueden sincronizar por día — a tener en cuenta al diseñar la frecuencia de los jobs de BullMQ.

**Pendiente relacionado:** si el volumen de ligas crece, evaluar upgrade a plan pago (~$19-39/mes) o revisar el split con The Odds API.

## 2026-08-06 — Paso 3 del roadmap (Ingesta): módulo API-Football + BullMQ

**Decisión:** `core/integrations/api-football` (cliente HTTP tipado, solo los endpoints que usamos) + `domain/ingestion` (`IngestionService` hace upsert en Prisma por `externalId`; `IngestionController` expone `POST /v1/ingestion/sync` como trigger manual; `IngestionProcessor` + un job repetible de BullMQ corren la sincronización diaria a las 06:00). Alcance: una sola liga configurable por env (`API_FOOTBALL_LEAGUE_ID`, default 39 = Premier League — verificar contra tu cuenta), fixtures de toda la temporada en una sola llamada, odds 1X2 solo de los próximos 3 días. Presupuesto estimado: ~5 requests/día del plan Free (100/día), dejando margen para pruebas manuales.

**Motivo:** ejecutar el Paso 3 sin exceder la cuota del plan Free, y sin acoplar la lógica de ingesta a los módulos de dominio (que hoy son stubs vacíos) — `IngestionService` habla directo con `PrismaService`.

**Cambio de `apps/api/package.json`:** `postinstall: "prisma generate"` (agregado en el Paso 2) ahora falla de forma no bloqueante (`|| echo ...`) en vez de abortar `pnpm install`. Se detectó en este entorno que un `prisma generate` fallido (por ejemplo, sin acceso a `binaries.prisma.sh`) hacía fallar la instalación completa del monorepo. Con el cambio, `pnpm install` siempre termina; si `prisma generate` no corrió, se avisa por consola y hay que correrlo a mano.

**`MatchStatus` como union local en `ingestion.service.ts`:** en vez de importar el enum generado por Prisma, se declaró una union de strings equivalente. Evita que el build dependa de que `prisma generate` ya se haya ejecutado (son estructuralmente compatibles).

**Verificación:** `pnpm install`, build y tests de `apps/api` pasan. Lint muestra errores `no-unsafe-*` únicamente en las líneas que llaman a `this.prisma.<model>.*`, porque el cliente de Prisma no está generado en este sandbox (mismo motivo documentado en el Paso 2) — se resuelven solos al correr `pnpm install` con red real. No fue posible probar la llamada real a `api-football.com` ni correr `prisma migrate dev` en este entorno (ambos dominios bloqueados en el sandbox); queda para tu máquina.

**Pendiente relacionado:** confirmar que `API_FOOTBALL_LEAGUE_ID=39` (Premier League) es la liga que quieres seguir, o cambiarla. Endpoint de sync manual sin autenticación todavía.

## 2026-08-06 — Paso 4 del roadmap (Modelos): Poisson, Elo y Expected Value

**Decisión:** `domain/predictions/models/{poisson,elo,expected-value}.model.ts` como funciones puras (sin dependencias de Nest/Prisma), orquestadas por `PredictionsService` contra los datos ya ingeridos. Endpoints `POST /v1/predictions/generate` (con `?matchId=` opcional) y `GET /v1/predictions/value-bets?minEdge=`.

- **Poisson**: fuerza de ataque/defensa de cada equipo relativa al promedio de goles de la liga (local/visitante por separado), matriz de probabilidad de marcador (Poisson independiente, `maxGoals=8`, sin corrección Dixon-Coles).
- **Elo**: rating recalculado on-demand repasando el historial de `Result` (K=20, ventaja de local = 60 puntos, no se persiste en `Team`). La probabilidad de empate es una heurística derivada de la cercanía de ratings — Elo clásico no la modela; queda para recalibrar con backtesting real.
- **Expected Value**: `edge = probabilidadDelModelo × cuotaDecimal − 1`; probabilidad implícita `1/cuota` sin descontar el margen de la casa (overround). Umbral configurable vía `VALUE_BET_EDGE_THRESHOLD` (default 2%).
- Poisson y Elo se guardan como predicciones independientes (`modelName: "poisson_v1"` / `"elo_v1"`) en vez de combinarse, para poder comparar cuál acierta más una vez haya suficiente historial.

**Motivo:** ejecutar la Fase 1 de docs/AI_MODELS.md tal como está definida, sin adelantar Fase 2 (XGBoost/LightGBM) ni la explicación del LLM (docs/DECISION_ENGINE.md: "el LLM solo explica" — no está en el alcance de este paso).

**Verificación:** las tres funciones de modelos son puras y se probaron con 11 tests unitarios reales (sin necesidad de DB ni red) — corren y pasan en este entorno, a diferencia del resto del código que depende de Prisma. Build y el total de 12 tests de `apps/api` pasan. El lint solo reporta el mismo patrón `no-unsafe-*` ya documentado (cliente de Prisma sin generar en este sandbox).

**Pendiente relacionado:** con pocos partidos históricos, Poisson y Elo pueden dar estimaciones poco confiables (el código no impone un mínimo de partidos jugados) — revisar una vez haya datos reales. Sin backtesting todavía para validar qué tan calibrados están los modelos.

## 2026-08-06 — Corrección: `DATABASE_URL`/`REDIS_URL` dentro de Docker Compose

**Problema detectado:** al preparar el paso a paso para correr el proyecto, noté que `api` usaba el `.env` compartido con `DATABASE_URL`/`REDIS_URL` apuntando a `localhost`. Dentro de la red de Docker Compose, `localhost` en el contenedor de `api` es el propio contenedor, no `postgres`/`redis` — la conexión habría fallado apenas se corriera `docker compose up`.

**Corrección:** `docker-compose.yml` ahora sobreescribe `DATABASE_URL`/`REDIS_URL` para el servicio `api` apuntando a los nombres de servicio (`postgres`, `redis`). El `.env` con `localhost` se mantiene igual y sigue siendo correcto para correr la API fuera de Docker (`pnpm --filter @edgeiq/api dev`).

**Pendiente relacionado:** `NEXT_PUBLIC_API_URL` se hornea en el bundle de cliente al momento del `next build`, no en runtime. El `Dockerfile` de `web` no pasa esa variable como build-arg todavía — no bloquea el desarrollo local (`next dev` sí la lee en runtime), pero hay que resolverlo antes de un build de producción real.

## 2026-08-06 — Corrección: Postgres del host expuesto en 5433, no 5432

**Problema detectado:** al correr `prisma migrate dev` desde la máquina del usuario (fuera de Docker), Prisma se conectaba a un Postgres nativo ya corriendo en `127.0.0.1:5432` (Homebrew/Postgres.app) en vez del Postgres de Docker Compose — en macOS, un proceso que escucha en `127.0.0.1:5432` específicamente tiene prioridad sobre el proxy de Docker escuchando en el wildcard `*:5432` para conexiones a `localhost`. Error: `P1010: User was denied access`, porque el usuario `edgeiq` no existe en ese Postgres nativo.

**Corrección:** `docker-compose.override.yml` mapea Postgres a `5433:5432` en el host (en vez de `5432:5432`). `.env`/`.env.example` (raíz y `apps/api`) actualizados a `DATABASE_URL=...@localhost:5433/edgeiq`. Dentro de la red de Docker no cambia nada: el `api` sigue conectándose vía `postgres:5432` (puerto interno del contenedor, no el mapeado al host).

**Alternativa considerada:** pedir al usuario que detenga su Postgres nativo (`brew services stop postgresql`) — descartada porque puede estar en uso por otro proyecto; remapear el puerto es menos invasivo.

**Nota:** los contenedores ya estaban corriendo con el mapeo viejo (5432) cuando se detectó esto — hace falta `docker compose down` y volver a levantar para que tome el nuevo mapeo.

## 2026-08-06 — Corrección: falta `.dockerignore`, binario de Prisma equivocado

**Problema detectado:** al levantar `docker compose up --build` en la máquina del usuario (macOS/Apple Silicon), el contenedor `api` fallaba con `PrismaClientInitializationError`: el motor de Prisma cargado era para `darwin-arm64` en vez de `linux-musl-arm64-openssl-3.0.x`. Causa: no existía `.dockerignore`, así que el `COPY . .` del `Dockerfile` (etapa `dev`) copiaba el `node_modules` del host (compilado en macOS al correr `pnpm install` local) encima del `node_modules` que el contenedor ya había instalado correctamente para Linux en la etapa `deps` — incluyendo el cliente de Prisma ya generado con el binario equivocado.

**Corrección:** se agregó `.dockerignore` en la raíz excluyendo `node_modules`, `.next`, `dist`, `coverage`, `.git` y `.env*` del build context, para que `COPY . .` nunca sobreescriba lo que el contenedor instaló para su propia plataforma.

**Impacto:** hace falta reconstruir la imagen (`docker compose up --build`, o `docker compose down` seguido de `up --build` si los volúmenes anónimos de `node_modules` ya quedaron sembrados con el contenido equivocado).

## 2026-08-06 — Corrección: `prisma generate` corría antes de que existiera `schema.prisma` en la imagen

**Problema detectado:** después de corregir el `.dockerignore`, el contenedor `api` fallaba con `Error: @prisma/client did not initialize yet. Please run "prisma generate"`. Causa: la etapa `deps` de los Dockerfiles solo copia los `package.json` (para aprovechar el cache de capas de Docker) antes de correr `pnpm install --frozen-lockfile` — pero el `postinstall: prisma generate` de `apps/api` necesita `apps/api/prisma/schema.prisma`, que en ese punto del build todavía no se había copiado. El fallback no bloqueante (`|| echo ...`, ver decisión del Paso 3) hizo que esto fallara en silencio en vez de romper el build, así que nunca se detectó hasta correr el contenedor.

**Corrección:** ambos Dockerfiles (`apps/api` y `apps/web`) ahora copian `apps/api/prisma` en la etapa `deps`, antes de `pnpm install`. Como `pnpm install` en la raíz instala todo el workspace (no solo el paquete del Dockerfile actual), el `postinstall` de `apps/api` corre también al construir la imagen de `web` — por eso el fix aplica a los dos Dockerfiles, no solo al de `api`.

**Impacto:** requiere reconstruir de nuevo (`docker compose down -v && docker compose up --build`).

## 2026-08-06 — `POST /v1/ingestion/sync?season=` para resolver el arranque en frío

**Problema detectado:** con la temporada 2026 recién empezada, la ingesta trajo 380 fixtures pero 0 resultados (`Result`) — ningún partido se había jugado todavía. `PredictionsService` no pudo generar ninguna predicción: Poisson necesita promedios de goles de la liga y Elo necesita historial de resultados, y no había ninguno.

**Corrección:** `IngestionService.syncLeague/syncFixtures/syncAll` ahora aceptan un `season` opcional (default: `API_FOOTBALL_SEASON` del env), expuesto como query param `POST /v1/ingestion/sync?season=2025`. Como `League` no está atada a una temporada (decisión del Paso 2), sincronizar una temporada pasada agrega resultados históricos a la misma liga sin duplicar nada — los fixtures de la temporada actual (upsert por `externalId`) conviven con el historial. Las cuotas (`syncUpcomingOdds`) siempre usan la temporada actual, no tiene sentido pedir cuotas de partidos históricos.

**Motivo del enfoque:** evita tener que reiniciar el contenedor (cambiar `API_FOOTBALL_SEASON` en `.env`) cada vez que se quiere alternar entre temporada actual e histórica.

**Pendiente relacionado:** con muy pocos resultados en la temporada actual, las predicciones se apoyan casi enteramente en la temporada anterior — razonable como fallback, pero conviene revisar más adelante si conviene ponderar más la temporada en curso a medida que avanza.

## 2026-08-06 — Upgrade a API-Football plan Pro

**Decisión:** pasar de plan Free a **Pro ($19/mes, 7 500 requests/día)**.

**Motivo:** al probar la ingesta real se confirmó que el plan Free no da acceso a la temporada actual (`{"errors":{"plan":"Free plans do not have access to this season, try from 2022 to 2024."}}`) — bloqueante para el objetivo del proyecto (partidos y cuotas recientes, no histórico de hace 2-4 años). Con nuestro consumo real (~5-10 requests/día por liga) el plan Pro deja muchísimo margen; no se justifica Ultra ($29) o Mega ($39) a menos que se sigan muchas ligas en simultáneo.

**Verificación:** `GET /status` de API-Football confirmó `"subscription":{"plan":"Pro","active":true}`.

**Pendiente relacionado:** revisar `docs/TODO.md` "Crear MVP" — con datos reales fluyendo, deja de haber justificación para seguir en plan Free como default documentado; se actualizó ahí también.

## 2026-08-06 — Verificación end-to-end en la máquina del usuario

**Resultado:** con las correcciones de Docker (`.dockerignore`, orden de copia de `prisma/`, puerto de Postgres, `DATABASE_URL`/`REDIS_URL` internos) y el upgrade a Pro, se corrió el pipeline completo real: `pnpm install` → `docker compose up` → `prisma migrate dev` → `POST /v1/ingestion/sync` (temporada 2026 + 2025 histórico, 380+380 fixtures) → `POST /v1/predictions/generate` (380/380 generadas, Poisson + Elo) → `GET /v1/predictions/value-bets` (vacío, correctamente: no hay cuotas publicadas todavía para el próximo partido, 21 de agosto).

Todos los bugs encontrados en el camino (puerto de Postgres, `.dockerignore`, orden de copia en el Dockerfile, ventana de días de cuotas) están documentados arriba con su corrección. Los Pasos 1-4 del roadmap quedan validados con datos reales, no solo con build/tests.

## 2026-08-06 — Soporte multi-liga

**Decisión:** `API_FOOTBALL_LEAGUE_ID` (una sola liga) → `API_FOOTBALL_LEAGUE_IDS` (lista separada por comas). Ligas configuradas: Premier League (39), La Liga (140), Serie A Italia (135), Bundesliga (78), Ligue 1 (61), Champions League (2), Europa League (3), Copa Libertadores (13), Brasileirão Série A (71), Primera A Colombia / Liga BetPlay Dimayor (239). IDs verificados contra la API real (`/leagues?country=`, `/leagues?search=`), no asumidos de memoria.

**Cambios:**
- `IngestionService.syncAll({ leagueId?, season? })` recorre todas las ligas configuradas por defecto (secuencial, no en paralelo); `leagueId` permite apuntar a una sola. Cada liga se sincroniza con manejo de error independiente — si una falla (ej. plan sin acceso a esa liga), las demás igual se sincronizan.
- `PredictionsService.generateForUpcoming(externalLeagueId?)` genera para todas las ligas ya ingeridas por defecto, no solo una. Devuelve desglose por liga.
- `GET /v1/predictions/value-bets` no necesitó cambios: nunca filtró por liga, así que ya agrega resultados de todas las competiciones — es lo que responde "las mejores opciones" entre todas.

**Motivo:** el usuario quiere comparar value bets across todas sus ligas de interés, no solo una. El diseño de `League` sin atarse a temporada (Paso 2) ya permitía esto estructuralmente; solo hacía falta que la capa de orquestación dejara de asumir una sola liga.

**Aviso de calidad de datos:** Champions League, Europa League y Copa Libertadores son competiciones de grupos + eliminación directa, no ligas de todos-contra-todos — menos partidos por competición y equipos de distintas ligas domésticas mezclados. Poisson/Elo van a dar estimaciones más ruidosas ahí que en las ligas regulares, especialmente al principio. No bloqueante, pero a tener en cuenta al leer los value bets de esas competiciones.

**Verificación:** build y los 12 tests de `apps/api` pasan. Lint solo con el patrón `no-unsafe-*` ya documentado.

## 2026-08-06 — Eliminar años e IDs quemados: resolución dinámica

**Problema planteado por el usuario:** (1) `API_FOOTBALL_SEASON` fijo en `.env` obligaría a editar código cada año. (2) Los IDs numéricos de liga en `.env` se sentían como "números mágicos" poco confiables — ¿no hay un código más estable?

**Investigación:** se confirmó contra la API real que las ligas de API-Football NO tienen un campo tipo código corto (solo `id`, `name`, `type`; el país sí tiene `code`, ej. "GB-ENG", pero la liga no). En cambio, `/leagues` devuelve un arreglo `seasons[]` con un flag **`current: true`** que la propia API calcula por liga, respetando el calendario real de cada una (europeas ago-may, Brasil/Colombia/Libertadores por año calendario) — y soporta filtrar directamente con `?current=true`. Combinando `name`+`country`+`current=true` en una sola llamada se resuelve el ID real y la temporada actual al mismo tiempo, sin lógica de fechas propia.

**Decisión:**
- `apps/api/src/domain/ingestion/leagues.config.ts` — las 10 ligas configuradas por `name`+`country` (código versionado, legible, no números mágicos). Ejemplo: `{ name: 'UEFA Champions League', country: 'World' }`.
- `ApiFootballService.resolveLeague({ id } | { name, country })` — resuelve contra `/leagues?...&current=true`, devuelve `{ id, name, country, currentSeason }`. Si no encuentra la liga, devuelve `null` y se registra un warning explícito en vez de fallar en silencio o traer datos equivocados.
- `IngestionService.syncAll()` ya no lee `API_FOOTBALL_LEAGUE_IDS`/`API_FOOTBALL_SEASON` del env (se eliminaron de `.env`/`.env.example`, raíz y `apps/api`). Cada corrida resuelve la temporada actual real por liga. Las `BACKFILL_SEASONS` (2) anteriores se sincronizan automáticamente **solo si no hay datos ya** para esa liga+temporada (`prisma.match.count`) — así el backfill de arranque en frío es automático sin gastar cupo de más en corridas repetidas.
- `?season=` en `POST /v1/ingestion/sync` sigue existiendo para forzar una temporada puntual (uso manual/debug), y en ese caso desactiva el backfill automático.

**Motivo:** que el sistema corra indefinidamente sin intervención manual por cambio de año, y que la configuración de ligas sea auditable (nombre+país legibles) y se auto-valide contra la API en vez de confiar ciegamente en un número.

**Verificación:** build y los 12 tests de `apps/api` pasan. Lint solo con el patrón `no-unsafe-*` ya documentado (más un `require-await` real que se corrigió).

## 2026-08-08 — Bug: Poisson predice "empate 100%" sin historial + predicciones duplicadas

**Problema detectado por el usuario:** en `GET /v1/predictions/value-bets`, los primeros ~10 resultados (mayor edge) eran todos `poisson_v1` con `modelProbability: "1"` para `Draw` — equipos de fases previas de Champions/Europa League sin ningún partido con resultado en nuestra base (ej. Omonia Nicosia, Vikingur Reykjavik, Saburtalo).

**Causa raíz (`poisson.model.ts`):** cuando un equipo tiene `matchesPlayed = 0`, `rate()` devuelve 0, los goles esperados (λ) dan 0, y `poissonPmf(0, 0) = 1` — matemáticamente correcto para Poisson, pero degenerado como predicción: `P(empate 0-0) = 1 × 1 = 100%` no es una señal real, es ausencia total de datos disfrazada de certeza.

**Corrección:** `PredictionsService.generateForMatch` ahora omite `poisson_v1` cuando alguno de los dos equipos tiene `matchesPlayed === 0` en esa liga (mismo criterio que `getLeagueGoalAverages` devolviendo `null`: sin datos, no se fabrica una predicción). `elo_v1` sigue generándose siempre — usa un rating neutral por defecto para equipos sin historial, no degenera de la misma forma.

**Segundo problema encontrado al verificar el fix:** las predicciones viejas (con el bug) seguían apareciendo en `value-bets` después de corregir el modelo y regenerar. Causa: `Prediction` no tenía restricción única sobre `(matchId, market, selection, modelName)` y `storePrediction` usaba `create` — cada `POST /predictions/generate` acumulaba filas nuevas en vez de reemplazar las anteriores, así que tanto las predicciones buenas duplicadas como las viejas degeneradas quedaban conviviendo indefinidamente.

**Corrección:** `@@unique([matchId, market, selection, modelName])` en el schema + `storePrediction` usa `upsert` en vez de `create`. Cada regeneración ahora actualiza la predicción vigente para esa combinación en vez de crear una fila nueva. Se agregó `updatedAt` para poder ver cuándo se refrescó cada predicción.

**Pendiente de ejecutar en la máquina del usuario (ver TODO.md):** limpiar las filas duplicadas/degeneradas ya guardadas (la tabla `Prediction` es 100% regenerable, más simple truncarla que escribir SQL de deduplicación) y correr `prisma migrate dev` para aplicar la restricción única.

**Verificación:** `tsc --noEmit` sin errores. No se pudo correr `prisma generate`/`migrate` en el sandbox (mismo bloqueo de red ya documentado); pendiente de confirmar en la máquina real.

## 2026-08-08 — Guard refinado: validar λ, no solo matchesPlayed

**Problema detectado:** un caso residual de `modelProbability: "1"` en Slovan Bratislava vs Mjallby AIF — ambos equipos tenían `matchesPlayed > 0` pero 0 goles anotados en su rol (local/visitante), dando `λ=0` → `poissonPmf(0,0)=1` → empate 100%.

**Corrección:** el guard de `PredictionsService.generateForMatch` ahora evalúa `goals.home > 0 && goals.away > 0` **después** de calcular `expectedGoals`, no solo `matchesPlayed > 0`. Cubre ambos casos: sin partidos jugados y con partidos pero sin goles en ese rol.

## 2026-08-09 — Predicción de eventos de partido: Nivel 1 (equipo) + Nivel 2 (jugador)

**Decisión:** extender el pipeline de predicciones con dos niveles de mercados de eventos, usando la misma base de Poisson que ya funciona para goles.

### Nivel 1 — Over/Under por equipo (events_poisson_v1)

**Mercados:** Corners O/U (7.5–11.5), Shots on Target O/U (3.5–6.5), Yellow Cards O/U (2.5–5.5). Líneas estándar configurables en `events-poisson.model.ts`.

**Enfoque:** Poisson con fuerza relativa al promedio de la liga, idéntico a goles. Para cada stat tipo evento:
1. Calcular promedio de la liga (local vs visitante separado) usando `MatchStatistic` de partidos terminados.
2. Fuerza relativa del equipo = su promedio / promedio de la liga (en ese rol).
3. λ = promedio de la liga × fuerza del equipo.
4. P(Over) y P(Under) sumando la distribución de Poisson bivariada (local + visitante independiente) sobre la línea.

**Datos requeridos:** `MatchStatistic` — stats de equipo por partido terminado (corners, tiros a puerta, tarjetas amarillas, rojas, faltas, tiros totales). Se ingieren desde API-Football `/fixtures/statistics`, un request por partido.

### Nivel 2 — Over/Under por jugador (player_poisson_v1)

**Mercados:** Player Shots on Target O/U (0.5–2.5), Player Total Shots O/U (0.5–3.5), Player Goals O/U (0.5–1.5), Player Yellow Cards O/U (0.5–1.5). Líneas configurables en `player-poisson.model.ts`.

**Enfoque:** Poisson simple con λ = promedio por partido del jugador (solo partidos con ≥ 45 min jugados). Sin fuerza relativa a la liga — el historial individual es la señal principal. Mínimo 5 partidos para generar predicción (evitar ruido con muestra pequeña).

**Datos requeridos:** `PlayerMatchStat` — stats individuales por jugador por partido (tiros, goles, tarjetas, minutos). Se ingieren desde API-Football `/fixtures/players`, un request por partido.

### Presupuesto de API

Cada partido terminado requiere 2 requests extra (stats + players). Para controlar el consumo, la ingesta procesa máximo `STATS_BATCH_SIZE=30` partidos por liga por sync que aún no tengan stats. Con 10 ligas → ~600 requests/sync, dentro del margen del plan Pro (7 500/día). El backfill completo de partidos históricos ocurre orgánicamente en varias corridas del job diario.

### Schema

Nuevos modelos Prisma:
- `MatchStatistic`: `@@unique([matchId, teamId])`, campos flat (corners, shotsOnTarget, shotsTotal, yellowCards, redCards, fouls).
- `PlayerMatchStat`: `@@unique([matchId, playerId])`, campos flat (minutes, shotsTotal, shotsOn, goals, assists, yellowCards, redCards, foulsCommitted, foulsDrawn).

Se eligió schema flat (columnas dedicadas) en vez de EAV (`statType`+`value`) porque: consultas más simples para promedios, mejor type safety, y sabemos exactamente qué stats modelamos.

### Limitaciones conocidas

- ~~**Sin odds de casas para estos mercados todavía**~~ → resuelto en la entrada 2026-08-09 (odds O/U).
- **Poisson independiente:** asumimos corners del local y del visitante son independientes, lo cual es una simplificación (en realidad correlacionan con posesión/dominio).
- ~~**Player stats sin ajuste por rival**~~ → resuelto en la entrada 2026-08-09 (rival adjustment).

**Verificación:** modelos validados con ts-node (assertions pasadas). Requiere `prisma migrate dev` en la máquina del usuario para crear las nuevas tablas.

## 2026-08-09 — Ingesta de odds Over/Under multi-mercado

**Decisión:** extender `syncUpcomingOdds` para ingerir no solo 1X2 sino todos los mercados de over/under relevantes usando un sistema declarativo de parsers (`ODDS_MARKET_MAPPINGS` en `ingestion.constants.ts`).

**Mercados soportados:**
- Goals O/U (bet names: "Goals Over/Under", "Over/Under")
- Corners O/U (bet names: "Asian Corners Over/Under", "Corners Over Under", "Total - Corners")
- Yellow Cards O/U (bet names: "Total Cards", "Bookings Over/Under")
- Shots on Target O/U (bet names: "Shots on Target Over/Under")
- 1X2 (Match Winner)

Cada mapping tiene un `parse(value)` que transforma strings del tipo `"Over 2.5"` en `{market: "Corners O/U 8.5", selection: "Over"}`, normalizando el formato para coincidir con las predicciones de `events_poisson_v1`.

**Impacto:** `storeRawPrediction()` ya busca las odds más recientes del mismo `market`+`selection` para calcular edge automáticamente. Al ingerir odds O/U, las predicciones de eventos que antes tenían `edge: null` ahora se evalúan como value bets.

**Descubrimiento importante:** API-Football NO ofrece odds de player props (tiros por jugador, goles por jugador, etc.) — solo mercados a nivel de equipo. Las predicciones de jugador (`player_poisson_v1`) seguirán sin edge hasta que se integre un proveedor alternativo de odds de player props.

## 2026-08-09 — Dixon-Coles: corrección para marcadores bajos

**Decisión:** aplicar la corrección Dixon-Coles (1997) al modelo Poisson de goles para ajustar la correlación negativa en marcadores bajos (0-0, 1-0, 0-1, 1-1).

**Implementación:** función `dixonColesTau(h, a, λ_h, λ_a, ρ)` que multiplica las probabilidades de Poisson independiente por un factor de corrección τ. Solo afecta 4 celdas de la matriz de marcadores; el resto permanece τ=1.

**Parámetro ρ:** valor fijo empírico de -0.05, representativo para ligas europeas principales según la literatura. El signo negativo indica que marcadores muy bajos son más probables de lo que Poisson independiente predice. Idealmente se estimaría con MLE (Maximum Likelihood Estimation) sobre el historial completo de la liga — queda como mejora futura.

**Alternativa descartada:** Poisson bivariado completo — más complejo, requiere copula fitting, y Dixon-Coles cubre el efecto principal con mínima complejidad adicional.

## 2026-08-09 — Ajuste por rival en predicciones de jugador

**Decisión:** el λ del jugador (promedio por partido) ahora se multiplica por un factor de ajuste que refleja la fuerza defensiva del rival.

**Cálculo:** para un stat dado (ej. shotsOnTarget), se mide cuánto concede el rival de ese stat versus el promedio de la liga. "Conceder" = los stats que los oponentes del rival producen cuando juegan contra él (no los stats propios del rival).

**Ejemplo:** si el promedio de la liga es 4.5 tiros a puerta por equipo visitante, y los visitantes promedian 5.5 contra el Real Madrid como local, el factor es 5.5/4.5 ≈ 1.22 → boost de 22% al λ del jugador visitante.

**Mapeo de stats:**
- `shotsOn`, `shotsTotal`, `goals` → se mide por `shotsOnTarget` concedido (mejor proxy de permeabilidad defensiva)
- `yellowCards` → sin ajuste (factor = 1.0), no tiene relación causal directa con el rival

**Clamp:** factor limitado a [0.5, 2.0] para no distorsionar excesivamente predicciones con pocos datos.

## 2026-08-09 — Jest + ts-jest: pinear a v29

**Problema:** Jest 30 no es compatible con ts-jest (la última release es 29.4.12, no existe ts-jest 30). El scaffold original tenía `jest: ^30.0.0` pero el lockfile resolvía a Jest 30.4.2, causando "Module ts-jest in the transform option was not found".

**Solución:** pinear ambos a la línea 29: `jest: ^29.7.0`, `ts-jest: ^29.2.5`, `@types/jest: ^29.5.0`. Se revalorará cuando ts-jest publique soporte para Jest 30.

## 2026-08-13 — Modelo ensemble: Poisson (75%) + Elo (25%)

**Decisión:** combinar Poisson y Elo con media ponderada (75/25). Poisson tiene ROI positivo (26.4%), Elo tiene ROI negativo (-2.7%), así que Elo solo aporta estabilidad sin dominar.

**Implementación:** `ensembleProbabilities()` en `models/ensemble.model.ts`. El peso se ajustó de 60/40 inicial a 75/25 tras backtesting que mostró que más Elo arrastra el ROI.

**Backtesting retroactivo:** para evaluar el ensemble sin esperar partidos nuevos, `BacktestingService` sintetiza `ensemble_v1` combinando predicciones históricas de `poisson_v1` + `elo_v1` en partidos FINISHED. Resultado: ensemble ROI 14.6% (entre Poisson y Elo, como se espera).

## 2026-08-13 — Umbral de edge subido a 5%

**Decisión:** `VALUE_BET_EDGE_THRESHOLD` de 2% → 5%. Filtra bets de baja calidad donde el edge es demasiado pequeño para compensar el vig real de las casas de apuestas.

**Motivo:** con edge 2%, muchas "value bets" tenían ventaja teórica mínima que se pierde con cualquier imprecisión del modelo. El 5% exige ventaja más convincente.

## 2026-08-13 — Calibración Platt scaling

**Decisión:** calibrar probabilidades post-modelo con Platt scaling (regresión logística sobre log-odds), entrenada con predicciones históricas vs resultados reales.

**Implementación:** `fitPlattScaling()` con Newton-Raphson, parámetros separados por selección (Home/Draw/Away). `CalibrationService` cachea parámetros en memoria y los recalcula en cada run de predicciones.

**Problemas encontrados y fixes:**
1. **Divergencia con pocos datos** — con solo 34 partidos, Newton-Raphson divergía (a=254228). Fix: regularización fuerte (λ=1.0), clamp de parámetros (a∈[0.1,10], b∈[-5,5]), y mínimo subido a 20 muestras en `fitPlattScaling`.
2. **Calibración distorsionaba predicciones del modelo nuevo** — los parámetros entrenados con el modelo viejo (sin forma ponderada) se aplicaban al modelo nuevo, produciendo probabilidades dominadas por empates. Fix: mínimo subido a 100 partidos en `CalibrationService`, y validación post-calibración que descarta si cualquier prob < 3% o la desviación máxima > 25pp.

**Estado actual:** calibración deshabilitada de facto (no hay 100 partidos con el modelo actual). Se activará automáticamente cuando haya suficientes datos.

## 2026-08-13 — Forma reciente ponderada (decaimiento exponencial)

**Decisión:** `getTeamHomeStats` y `getTeamAwayStats` ahora ponderan los últimos 10 partidos con decaimiento exponencial (decay=0.85).

**Pesos resultantes:** [1.0, 0.85, 0.72, 0.61, 0.52, 0.44, 0.38, 0.32, 0.27, 0.23] — el partido más reciente pesa ~4x más que el décimo.

**Motivo:** el modelo anterior promediaba toda la temporada por igual. Si un equipo viene en racha (buena o mala), no se reflejaba hasta que la media global se movía. Con decaimiento exponencial, un equipo en forma tiene mayor fuerza de ataque/defensa inmediata.

**Compatibilidad con Poisson:** la función `rate()` sigue funcionando porque `matchesPlayed` ahora es `totalWeight` (float) en vez de cantidad de partidos (int). La división `goalsScored / matchesPlayed` sigue dando el promedio ponderado de goles por partido.

## 2026-08-13 — Explicaciones IA enriquecidas

**Decisión:** el `ExplanationsService` ahora recopila datos concretos antes de enviar el prompt al LLM (Groq):
- Forma reciente: últimos 5 partidos (racha W/D/L, goles GF/GC)
- Rendimiento como local/visitante: goles/partido, goles recibidos
- Historial directo (H2H): victorias, empates, promedio de goles
- Ventaja de local real: % de partidos ganados por el local en esa liga
- Bajas/lesiones activas

**Motivo:** las explicaciones anteriores eran genéricas ("el modelo detecta valor"). Ahora el LLM recibe datos específicos y debe citar números concretos. El prompt exige 4 oraciones, cada una con un dato numérico.

**Temperatura:** reducida de 0.4 a 0.3 para respuestas más consistentes y factuales.

## 2026-08-13 — Página "Recomendaciones IA" en el dashboard

**Decisión:** nueva página `/recommendations` como primera entrada del sidebar, dedicada exclusivamente a las recomendaciones de la IA con explicaciones detalladas.

**Diferencia con Value Bets:** la página Value Bets muestra todas las apuestas con edge positivo. Recomendaciones IA solo muestra las que tienen explicación generada por el LLM, priorizadas y con la sección "¿Por qué esta apuesta?".

**Funcionalidades:**
- Botón "Ejecutar análisis" que llama `POST /predictions/generate` desde la app
- Progress bar en tiempo real con polling cada 1.5s a `GET /predictions/generate/progress`
- 5 fases visibles: calibración → predicciones (X/Y partidos) → notificaciones → explicaciones IA (X/Y) → completado
- Contadores: analizadas por IA, confianza alta, pendientes de análisis

## 2026-08-13 — Progress bar para generación de predicciones

**Decisión:** tracking de progreso in-memory en `PredictionsService` con endpoint de polling `GET /predictions/generate/progress`.

**Alternativas consideradas:**
- SSE (Server-Sent Events) — más elegante pero requiere refactorizar el endpoint de generación
- WebSockets — overkill para un solo indicador de progreso
- Polling — simple, funcional, mínimos cambios al backend

**Implementación:** `GenerationProgress` con `{ status, phase, current, total, detail }`. El servicio actualiza el objeto en cada paso. El frontend pollea cada 1.5s y muestra una barra animada. Cuando `status === 'done'` o `'error'`, se detiene el polling.
