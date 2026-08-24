'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BarChart3, TrendingUp, Users, Zap, FlaskConical, LogOut, User, BrainCircuit, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from './theme-toggle';
import { useAuth } from '@/lib/auth';

const NAV_ITEMS = [
  { href: '/recommendations', label: 'Recomendaciones IA', icon: BrainCircuit },
  { href: '/', label: 'Value Bets', icon: Zap },
  { href: '/matches', label: 'Partidos', icon: BarChart3 },
  { href: '/teams', label: 'Equipos', icon: Shield },
  { href: '/players', label: 'Jugadores', icon: Users },
  { href: '/backtesting', label: 'Backtesting', icon: FlaskConical },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  // Hide sidebar on login page
  if (pathname === '/login') return null;

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <aside className="flex h-full w-60 flex-col border-r bg-card">
      {/* Logo */}
      <div className="flex items-center gap-2 border-b px-5 py-4">
        <TrendingUp className="size-6 text-emerald-500" />
        <span className="text-lg font-bold tracking-tight">EdgeIQ</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t px-3 py-3 space-y-2">
        {user && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <User className="size-4 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground truncate">{user.name || user.email}</span>
            </div>
            <button
              onClick={handleLogout}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Cerrar sesión"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        )}
        {!user && (
          <Link
            href="/login"
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <User className="size-4" />
            Iniciar sesión
          </Link>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">v0.1.0</span>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
