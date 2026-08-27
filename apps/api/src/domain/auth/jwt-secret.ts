import { ConfigService } from '@nestjs/config';

const INSECURE_DEV_DEFAULT = 'edgeiq-dev-secret-change-in-prod';

/**
 * Resuelve JWT_SECRET. En producción, sin un valor real configurado el
 * arranque falla en vez de firmar tokens con un secreto público y
 * conocido — el default inseguro solo aplica en dev/test.
 */
export function resolveJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (secret) return secret;

  if (config.get<string>('NODE_ENV') === 'production') {
    throw new Error(
      'JWT_SECRET es obligatorio en producción (NODE_ENV=production). ' +
        'Configúralo antes de arrancar la API.',
    );
  }

  return INSECURE_DEV_DEFAULT;
}
