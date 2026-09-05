import { Logger } from '@nestjs/common';

const logger = new Logger('DbRetry');

/**
 * Errores de conexión transitorios de Postgres/Prisma (la DB de Railway se
 * duerme/reinicia bajo carga — ver docs/DECISIONS.md). No son errores de
 * lógica: reintentar la misma query casi siempre funciona porque Prisma
 * reabre la conexión en el siguiente request.
 */
const TRANSIENT_PATTERNS = [
  "Server has closed the connection",
  "Can't reach database server",
  'Connection terminated',
  'ECONNRESET',
  'ETIMEDOUT',
];

function isTransient(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return TRANSIENT_PATTERNS.some((p) => message.includes(p));
}

/**
 * Reintenta `fn` ante errores transitorios de conexión con backoff fijo.
 * Usar solo en queries de lectura/upsert idempotentes dentro de procesos
 * largos (ej. generación de predicciones sobre cientos de partidos).
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 500,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt > retries || !isTransient(err)) throw err;
      logger.warn(
        `Reintentando tras error transitorio (intento ${attempt}/${retries}): ${
          err instanceof Error ? err.message : err
        }`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}
