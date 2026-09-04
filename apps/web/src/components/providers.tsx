'use client';

import { AuthProvider } from '@/lib/auth';
import { AuthGate } from './auth-gate';
import type { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <AuthGate>{children}</AuthGate>
    </AuthProvider>
  );
}
