'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Database, RefreshCw, Loader2, CheckCircle2, Lock, ListChecks } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface IngestionProgress {
  status: 'idle' | 'running' | 'done' | 'error';
  phase: string;
  current: number;
  total: number;
  detail: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface SyncOutcome {
  league: string;
  leagueId: number | null;
  season: number | null;
  fixtures: { synced: number } | { error: string };
  odds: { synced: number } | { error: string };
  matchStats: { synced: number } | { error: string };
  playerStats: { synced: number } | { error: string };
  injuries: { synced: number } | { error: string };
}

function countSynced(outcome: { synced: number } | { error: string }) {
  return 'synced' in outcome ? outcome.synced : 0;
}

export default function AdminPage() {
  const { user } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<IngestionProgress | null>(null);
  const [result, setResult] = useState<SyncOutcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const p = await apiFetch<IngestionProgress>('/ingestion/sync/progress');
        setProgress(p);
        if (p.status === 'done' || p.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {
        // Ignore polling errors
      }
    }, 1500);
  }, []);

  const runSync = async () => {
    setSyncing(true);
    setError(null);
    setResult(null);
    setProgress({ status: 'running', phase: 'sync', current: 0, total: 0, detail: 'Iniciando…', startedAt: null, finishedAt: null });
    startPolling();
    try {
      const data = await apiFetch<SyncOutcome[]>('/ingestion/sync', { method: 'POST' });
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falló la sincronización');
    } finally {
      setSyncing(false);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Database className="size-6 text-emerald-500" />
        <h1 className="text-2xl font-bold tracking-tight">Sincronización de datos</h1>
      </div>
      <p className="text-muted-foreground text-sm">
        Trae fixtures, cuotas, estadísticas y lesiones desde API-Football hacia la base de datos.
        Corre automáticamente todos los días, pero puedes forzarla manualmente desde aquí.
      </p>

      {!user ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Lock className="mx-auto size-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              Necesitas iniciar sesión para ejecutar la sincronización manual.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <RefreshCw className="size-4 text-emerald-500" />
                  <span className="text-sm font-semibold">Sincronización manual</span>
                </div>
                {!syncing && (
                  <p className="text-xs text-muted-foreground">
                    Recorre todas las ligas configuradas (secuencial, respetando el rate limit de la API). Puede tomar varios minutos.
                  </p>
                )}
              </div>
              <Button
                onClick={runSync}
                disabled={syncing}
                className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
                size="sm"
              >
                {syncing ? (
                  <>
                    <Loader2 className="size-3 mr-1.5 animate-spin" />
                    Sincronizando…
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-3 mr-1.5" />
                    Ejecutar sincronización
                  </>
                )}
              </Button>
            </div>

            {/* Progress bar */}
            {syncing && progress && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-emerald-500 font-medium">Sincronizando ligas</span>
                  {progress.total > 0 && (
                    <span className="text-muted-foreground">
                      {progress.current}/{progress.total}
                    </span>
                  )}
                </div>
                <div className="relative h-2.5 rounded-full bg-muted overflow-hidden">
                  {progress.total > 0 ? (
                    <div
                      className="absolute left-0 top-0 h-full rounded-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${Math.min((progress.current / progress.total) * 100, 100)}%` }}
                    />
                  ) : (
                    <div
                      className="absolute left-0 top-0 h-full w-1/3 rounded-full bg-emerald-500/60"
                      style={{ animation: 'admin-shimmer 1.5s ease-in-out infinite' }}
                    />
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">{progress.detail}</p>
                <style>{`
                  @keyframes admin-shimmer {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(400%); }
                  }
                `}</style>
              </div>
            )}

            {error && (
              <div className="mt-3 rounded-lg p-2.5 text-xs flex items-center gap-2 bg-red-500/10 text-red-400 border border-red-500/20">
                {error}
              </div>
            )}

            {!syncing && result && !error && (
              <div className="mt-3 rounded-lg p-2.5 text-xs flex items-center gap-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="size-3 shrink-0" />
                Sincronización completada: {result.length} liga(s) procesada(s).
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {result && result.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <ListChecks className="size-4" />
            Detalle por liga
          </div>
          {result.map((r) => (
            <Card key={`${r.league}-${r.season ?? 'na'}`}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm">{r.league}</span>
                  {r.season && <span className="text-xs text-muted-foreground">Temporada {r.season}</span>}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                  <StatCell label="Fixtures" outcome={r.fixtures} />
                  <StatCell label="Odds" outcome={r.odds} />
                  <StatCell label="Match stats" outcome={r.matchStats} />
                  <StatCell label="Player stats" outcome={r.playerStats} />
                  <StatCell label="Lesiones" outcome={r.injuries} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCell({ label, outcome }: { label: string; outcome: { synced: number } | { error: string } }) {
  const isError = 'error' in outcome;
  return (
    <div className="rounded-lg border p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className={isError ? 'text-red-400 font-medium' : 'text-foreground font-semibold'}>
        {isError ? 'Error' : countSynced(outcome)}
      </div>
    </div>
  );
}
