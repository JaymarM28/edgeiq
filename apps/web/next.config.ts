import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 'standalone' es lo que usa apps/web/Dockerfile para el deploy self-hosted
  // (Railway/Docker). En Vercel rompe el paso final del build (busca
  // .next/next-server.js.nft.json en la ubicación estándar, que 'standalone'
  // no genera ahí) — Vercel no lo necesita, tiene su propio output gestionado.
  ...(process.env.VERCEL ? {} : { output: 'standalone' }),
  transpilePackages: ['@edgeiq/shared'],
};

export default nextConfig;
