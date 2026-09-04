'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const PUBLIC_ROUTES = ['/login'];

/** Bloquea el render de rutas protegidas hasta confirmar sesión; sin sesión, redirige a /login. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);

  useEffect(() => {
    if (!isLoading && !user && !isPublicRoute) {
      router.replace('/login');
    }
  }, [isLoading, user, isPublicRoute, router]);

  if (isLoading) return null;
  if (!user && !isPublicRoute) return null;

  return <>{children}</>;
}
