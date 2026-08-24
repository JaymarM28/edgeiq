'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  BrainCircuit, RefreshCw, Loader2, Star, Target, AlertTriangle,
  TrendingUp, ArrowRight, CheckCircle2, Clock,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiFetch, type ValueBet } from '@/lib/api';

interface Progress {
  status: 'idle' | 'running' | 'done' | 'error';
  phase: string;
  current: number;
  total: number;
  detail: string;
  startedAt: string | null;
  finishedAt: string | null;
}

const PHASE_LABELS: Record<string, string> = {
  init: 'Inicializando',
  calibration: 'Calibrando modelos',
  predictions: 'Generando predicciones',
  notifications: 'Notificando',
  explanations: 'Generando explicaciones IA',
  done: 'Completado',
};

type Confidence = 'alta' | 'media' | 'baja';

function getConfidence(edge: number): Confidence {
  if (edge >= 0.15) return 'alta';
  if (edge >= 0.07) return 'media';
  return 'baja';
}

function confidenceLabel(c: Confidence) {
  return c === 'alta' ? 'Alta' : c === 'media' ? 'Media' : 'Baja';
}

function confidenceColor(c: Confidence) {
  return c === 'alta'
    ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
    : c === 'media'
      ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
      : 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30';
}

function confidenceAccent(c: Confidence) {
  return c === 'alta' ? 'text-emerald-500' : c === 'media' ? 'text-amber-500' : 'text-zinc-400';
}

function translateSelection(sel: string, home: string, away: string) {
  if (sel === 'Home') return home;
  if (sel === 'Away') return away;
  if (sel === 'Draw') return 'Empate';
  return sel;
}

export default function RecommendationsPage() {
  const [bets, setBets] = useState<ValueBet[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBets = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<ValueBet[]>('/predictions/value-bets')
      .then((data) => {
        setBets(data);
        setLastUpdated(new Date());
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchBets(); }, [fetchBets]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const p = await apiFetch<Progress>('/predictions/generate/progress');
        setProgress(p);
        if (p.status === 'done' || p.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          if (p.status === 'done') fetchBets();
        }
      } catch {
        // Ignore polling errors
      }
    }, 1500);
  };

  const runAnalysis = async () => {
    setAnalyzing(true);
    setAnalyzeResult(null);
    setProgress({ status: 'running', phase: 'init', current: 0, total: 0, detail: 'Iniciando...', startedAt: null, finishedAt: null });
    startPolling();
    try {
      const result = await apiFetch<{ generated: number; totalUpcoming: number }>(
        '/predictions/generate',
        { method: 'POST' },
      );
      setAnalyzeResult(`Análisis completo: ${result.generated} predicciones generadas de ${result.totalUpcoming} partidos`);
      fetchBets();
    } catch (e) {
      setAnalyzeResult(`Error: ${e instanceof Error ? e.message : 'Falló el análisis'}`);
    } finally {
      setAnalyzing(false);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
  };

  // Solo bets con explicación de la IA (las que la IA analizó)
  const aiRecommendations = bets
    .filter((b) => b.explanation)
    .sort((a, b) => {
      const aEns = a.modelName === 'ensemble_v1' ? 1 : 0;
      const bEns = b.modelName === 'ensemble_v1' ? 1 : 0;
      if (aEns !== bEns) return bEns - aEns;
      return (b.edge ?? 0) - (a.edge ?? 0);
    });

  const betsWithoutExplanation = bets.filter((b) => !b.explanation && (b.edge ?? 0) >= 0.05);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BrainCircuit className="size-6 text-blue-500" />
            <h1 className="text-2xl font-bold tracking-tight">Recomendaciones IA</h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            La IA analiza forma reciente, historial directo, ventaja de local y bajas para recomendar apuestas con datos concretos
          </p>
        </div>
      </div>

      {/* Analysis control */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <BrainCircuit className="size-4 text-blue-400" />
                <span className="text-sm font-semibold">Motor de análisis</span>
              </div>
              {!analyzing && (
                <p className="text-xs text-muted-foreground">
                  Recalcula predicciones con forma reciente, calibra modelos y genera explicaciones detalladas.
                </p>
              )}
              {lastUpdated && !analyzing && (
                <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground">
                  <Clock className="size-3" />
                  Última carga: {lastUpdated.toLocaleTimeString('es-ES')}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <Button
                onClick={runAnalysis}
                disabled={analyzing}
                className="bg-blue-600 hover:bg-blue-700 text-white"
                size="sm"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="size-3 mr-1.5 animate-spin" />
                    Analizando...
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-3 mr-1.5" />
                    Ejecutar análisis
                  </>
                )}
              </Button>
              {!analyzing && (
                <Button onClick={fetchBets} disabled={loading} variant="outline" size="sm">
                  <RefreshCw className={`size-3 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
                  Recargar
                </Button>
              )}
            </div>
          </div>

          {/* Progress bar */}
          {analyzing && progress && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-blue-400 font-medium">
                  {PHASE_LABELS[progress.phase] ?? progress.phase}
                </span>
                {progress.total > 0 && (
                  <span className="text-muted-foreground">
                    {progress.current}/{progress.total}
                  </span>
                )}
              </div>
              <div className="relative h-2.5 rounded-full bg-muted overflow-hidden">
                {progress.total > 0 ? (
                  <div
                    className="absolute left-0 top-0 h-full rounded-full bg-blue-500 transition-all duration-500"
                    style={{ width: `${Math.min((progress.current / progress.total) * 100, 100)}%` }}
                  />
                ) : (
                  <div className="absolute left-0 top-0 h-full w-1/3 rounded-full bg-blue-500/60 animate-[shimmer_1.5s_ease-in-out_infinite]"
                    style={{ animation: 'shimmer 1.5s ease-in-out infinite' }}
                  />
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">{progress.detail}</p>
              <style>{`
                @keyframes shimmer {
                  0% { transform: translateX(-100%); }
                  100% { transform: translateX(400%); }
                }
              `}</style>
            </div>
          )}

          {!analyzing && analyzeResult && (
            <div className={`mt-3 rounded-lg p-2.5 text-xs flex items-center gap-2 ${
              analyzeResult.startsWith('Error')
                ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            }`}>
              <CheckCircle2 className="size-3 shrink-0" />
              {analyzeResult}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats */}
      {!loading && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <BrainCircuit className="size-4 text-blue-400" />
              <span className="text-2xl font-bold text-blue-400">{aiRecommendations.length}</span>
            </div>
            <div className="text-sm font-medium mt-1">Analizadas por IA</div>
            <div className="text-xs text-muted-foreground">Con explicación detallada</div>
          </div>
          <div className="rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <Star className="size-4 text-emerald-500" />
              <span className="text-2xl font-bold text-emerald-500">
                {aiRecommendations.filter((b) => getConfidence(b.edge ?? 0) === 'alta').length}
              </span>
            </div>
            <div className="text-sm font-medium mt-1">Confianza Alta</div>
            <div className="text-xs text-muted-foreground">Edge &ge; 15%</div>
          </div>
          <div className="rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <AlertTriangle className="size-4 text-amber-500" />
              <span className="text-2xl font-bold text-amber-500">{betsWithoutExplanation.length}</span>
            </div>
            <div className="text-sm font-medium mt-1">Pendientes de análisis</div>
            <div className="text-xs text-muted-foreground">Ejecuta el análisis para procesarlas</div>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-44 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-destructive text-sm">Error: {error}</p>
            <p className="text-muted-foreground text-xs mt-2">Verifica que la API esté corriendo en localhost:4000</p>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!loading && !error && aiRecommendations.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <BrainCircuit className="mx-auto size-10 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground text-sm font-medium mb-1">
              No hay recomendaciones de la IA todavía
            </p>
            <p className="text-muted-foreground text-xs mb-4">
              Presiona &quot;Ejecutar análisis&quot; para que la IA analice los partidos próximos y genere recomendaciones con explicaciones detalladas.
            </p>
            <Button onClick={runAnalysis} disabled={analyzing} className="bg-blue-600 hover:bg-blue-700 text-white">
              {analyzing ? (
                <><Loader2 className="size-4 mr-2 animate-spin" /> Analizando...</>
              ) : (
                <><BrainCircuit className="size-4 mr-2" /> Ejecutar primer análisis</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* AI Recommendations */}
      {!loading && aiRecommendations.length > 0 && (
        <div className="space-y-4">
          {aiRecommendations.map((bet) => (
            <AIRecommendationCard key={bet.id} bet={bet} />
          ))}
        </div>
      )}
    </div>
  );
}

function AIRecommendationCard({ bet }: { bet: ValueBet }) {
  const edge = bet.edge ?? 0;
  const conf = getConfidence(edge);
  const edgePct = (edge * 100).toFixed(1);
  const modelPct = (bet.modelProbability * 100).toFixed(0);
  const housePct = bet.impliedProbability ? (bet.impliedProbability * 100).toFixed(0) : '—';
  const kickoff = new Date(bet.match.kickoffAt);
  const dateStr = kickoff.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeStr = kickoff.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  const recommendation = translateSelection(bet.selection, bet.match.homeTeam.name, bet.match.awayTeam.name);

  return (
    <Card className={`border-l-4 ${
      conf === 'alta' ? 'border-l-emerald-500' : conf === 'media' ? 'border-l-amber-500' : 'border-l-zinc-500'
    }`}>
      <CardContent className="py-5">
        {/* Top: recommendation */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <ArrowRight className={`size-4 ${confidenceAccent(conf)}`} />
              <span className="text-lg font-bold">{recommendation}</span>
              <Badge className={confidenceColor(conf) + ' text-[10px] font-semibold'}>
                {confidenceLabel(conf)}
              </Badge>
            </div>

            <div className="flex items-center gap-2 mt-1.5 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {bet.match.homeTeam.name} vs {bet.match.awayTeam.name}
              </span>
              <span>·</span>
              <span>{bet.match.league.name}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {dateStr} · {timeStr}
            </div>
          </div>

          {/* Edge */}
          <div className="text-right shrink-0">
            <div className={`text-2xl font-bold ${confidenceAccent(conf)}`}>+{edgePct}%</div>
            <div className="text-[10px] text-muted-foreground">ventaja</div>
          </div>
        </div>

        {/* Probability comparison */}
        <div className="mt-4 rounded-lg bg-muted/50 p-3">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-muted-foreground">
              Nuestro modelo: <span className="font-semibold text-foreground">{modelPct}%</span>
            </span>
            <span className="text-muted-foreground">
              Casa de apuestas: <span className="font-semibold text-foreground">{housePct}%</span>
            </span>
          </div>
          <div className="relative h-2.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`absolute left-0 top-0 h-full rounded-full ${
                conf === 'alta' ? 'bg-emerald-500' : conf === 'media' ? 'bg-amber-500' : 'bg-zinc-400'
              }`}
              style={{ width: `${Math.min(bet.modelProbability * 100, 100)}%` }}
            />
            {bet.impliedProbability && (
              <div
                className="absolute top-0 h-full w-0.5 bg-foreground/60"
                style={{ left: `${Math.min(bet.impliedProbability * 100, 100)}%` }}
              />
            )}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
            <TrendingUp className="size-3" />
            {bet.modelName === 'ensemble_v1' ? 'Ensemble (Poisson+Elo)' : bet.modelName === 'poisson_v1' ? 'Poisson' : bet.modelName}
          </div>
        </div>

        {/* AI Explanation — the star of this page */}
        {bet.explanation && (
          <div className="mt-4 rounded-lg bg-blue-500/5 border border-blue-500/20 p-4">
            <div className="flex items-center gap-2 mb-2">
              <BrainCircuit className="size-4 text-blue-400" />
              <span className="text-xs font-semibold text-blue-400">¿Por qué esta apuesta?</span>
            </div>
            <p className="text-sm text-foreground/90 leading-relaxed">{bet.explanation}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
