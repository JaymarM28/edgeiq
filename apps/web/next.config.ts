import path from 'path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 'standalone' es lo que usa apps/web/Dockerfile para el deploy self-hosted
  // (Railway/Docker). En Vercel rompe el paso final del build (busca
  // .next/next-server.js.nft.json en la ubicación estándar, que 'standalone'
  // no genera ahí) — Vercel no lo necesita, tiene su propio output gestionado.
  ...(process.env.VERCEL ? {} : { output: 'standalone' }),
  transpilePackages: ['@edgeiq/shared'],
  // Fija la raíz del monorepo explícitamente: sin esto, Turbopack puede
  // detectar por error un pnpm-workspace.yaml ajeno más arriba en el
  // filesystem (ej. en el home del usuario) y romper la resolución de
  // '@edgeiq/shared' dependiendo de desde dónde se corra `next dev`.
  turbopack: {
    root: path.join(__dirname, '..', '..'),
  },
};

export default nextConfig;
