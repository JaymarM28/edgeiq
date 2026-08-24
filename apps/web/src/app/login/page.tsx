'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { TrendingUp, ArrowLeft, Timer } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/v1';

type View = 'login' | 'register' | 'forgot' | 'reset';

export default function LoginPage() {
  const { login, register } = useAuth();
  const router = useRouter();
  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setSecondsLeft(15 * 60); // 15 min
    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const inputClass = 'w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (view === 'register') {
        await register(email, password, name || undefined);
      } else {
        await login(email, password);
      }
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? 'Error al enviar código');
      }
      setSuccess('Revisa tu correo. Te enviamos un código de 6 dígitos.');
      startTimer();
      setView('reset');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, newPassword }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? 'Error al resetear contraseña');
      }
      const data = await res.json();
      // Auto-login after reset
      localStorage.setItem('edgeiq_token', data.accessToken);
      localStorage.setItem('edgeiq_user', JSON.stringify(data.user));
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  const switchView = (v: View) => {
    setView(v);
    setError(null);
    setSuccess(null);
    setCode('');
    setNewPassword('');
  };

  const title = {
    login: 'Iniciar sesión',
    register: 'Crear cuenta',
    forgot: 'Recuperar contraseña',
    reset: 'Ingresa el código',
  }[view];

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-6">
          <div className="flex items-center justify-center gap-2 mb-6">
            <TrendingUp className="size-7 text-emerald-500" />
            <span className="text-xl font-bold tracking-tight">EdgeIQ</span>
          </div>

          {(view === 'forgot' || view === 'reset') && (
            <button
              onClick={() => switchView('login')}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
            >
              <ArrowLeft className="size-3" /> Volver al login
            </button>
          )}

          <h2 className="text-lg font-semibold text-center mb-4">{title}</h2>

          {/* Login / Register */}
          {(view === 'login' || view === 'register') && (
            <>
              <form onSubmit={handleLogin} className="space-y-3">
                {view === 'register' && (
                  <input type="text" placeholder="Nombre (opcional)" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
                )}
                <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} />
                <input type="password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className={inputClass} />
                {error && <p className="text-xs text-red-500 text-center">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Cargando...' : view === 'register' ? 'Registrarse' : 'Entrar'}
                </Button>
              </form>
              <div className="space-y-1 mt-3">
                <button onClick={() => switchView(view === 'register' ? 'login' : 'register')} className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center">
                  {view === 'register' ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate'}
                </button>
                {view === 'login' && (
                  <button onClick={() => switchView('forgot')} className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center">
                    ¿Olvidaste tu contraseña?
                  </button>
                )}
              </div>
            </>
          )}

          {/* Forgot — pedir email */}
          {view === 'forgot' && (
            <form onSubmit={handleForgot} className="space-y-3">
              <p className="text-xs text-muted-foreground text-center">Te enviaremos un código de 6 dígitos a tu correo.</p>
              <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} />
              {error && <p className="text-xs text-red-500 text-center">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Enviando...' : 'Enviar código'}
              </Button>
            </form>
          )}

          {/* Reset — código + nueva contraseña */}
          {view === 'reset' && (
            <form onSubmit={handleReset} className="space-y-3">
              {success && <p className="text-xs text-emerald-500 text-center">{success}</p>}

              {/* Cronómetro */}
              <div className="flex items-center justify-center gap-1.5">
                <Timer className={`size-4 ${secondsLeft > 0 ? 'text-emerald-500' : 'text-red-500'}`} />
                {secondsLeft > 0 ? (
                  <span className="text-sm font-mono font-medium text-muted-foreground">
                    Expira en <span className={secondsLeft <= 60 ? 'text-red-500 font-bold' : 'text-emerald-500 font-bold'}>{formatTime(secondsLeft)}</span>
                  </span>
                ) : (
                  <span className="text-sm text-red-500 font-medium">Código expirado</span>
                )}
              </div>

              <input
                type="text"
                placeholder="Código de 6 dígitos"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                maxLength={6}
                className={`${inputClass} text-center tracking-[0.5em] text-lg font-mono`}
              />
              <input type="password" placeholder="Nueva contraseña" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} className={inputClass} />
              {error && <p className="text-xs text-red-500 text-center">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading || code.length !== 6 || secondsLeft === 0}>
                {loading ? 'Actualizando...' : 'Cambiar contraseña'}
              </Button>
              <button
                type="button"
                onClick={() => { switchView('forgot'); }}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
              >
                Reenviar código
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
