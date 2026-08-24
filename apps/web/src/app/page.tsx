'use client';

import { useEffect, useState } from 'react';
import { Zap, TrendingUp, ArrowUpRight, Star, Target, AlertTriangle, BrainCircuit } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiFetch, type ValueBet } from '@/lib/api';

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

function confidenceBg(c: Confidence) {
  return c === 'alta'
    ? 'border-emerald-500/40'
    : c === 'media'
      ? 'border-amber-500/30'
      : '';
}

function translateSelection(sel: string, home: string, away: string) {
  if (sel === 'Home') return home;
  if (sel === 'Away') return away;
  if (sel === 'Draw') return 'Empate';
  if (sel === 'Over') return 'Más';
  if (sel === 'Under') return 'Menos';
  return sel;
}

function translateMarket(market: string) {
  if (market === '1X2') return 'Resultado';
  if (market.startsWith('O/U')) {
    const parts = market.replace('O/U ', '').split(' ');
    const stat = parts[0];
    const team = parts.slice(1).join(' ');
    const statMap: Record<string, string> = {
      corners: 'Córners', shots_total: 'Tiros totales', shots_on: 'Tiros a puerta',
      fouls: 'Faltas', yellow_cards: 'Tarjetas amarillas',
    };
    return `${statMap[stat] ?? stat} ${team}`;
  }
  return market;
}

export default function ValueBetsPage() {
  const [bets, setBets] = useState<ValueBet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'todas' | Confidence>('todas');

  useEffect(() => {
    apiFetch<ValueBet[]>('/predictions/value-bets')
      .then(setBets)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageSkeleton />;
  if (error) return <ErrorState message={error} />;

  // Sort: ensemble first, then by edge descending
  const sorted = [...bets].sort((a, b) => {
    const aEns = a.modelName === 'ensemble_v1' ? 1 : 0;
    const bEns = b.modelName === 'ensemble_v1' ? 1 : 0;
    if (aEns !== bEns) return bEns - aEns;
    return (b.edge ?? 0) - (a.edge ?? 0);
  });
  const filtered = filter === 'todas' ? sorted : sorted.filter((b) => getConfidence(b.edge ?? 0) === filter);

  const alta = sorted.filter((b) => getConfidence(b.edge ?? 0) === 'alta');
  const media = sorted.filter((b) => getConfidence(b.edge ?? 0) === 'media');
  const baja = sorted.filter((b) => getConfidence(b.edge ?? 0) === 'baja');

  // Group by match for parlay suggestions
  const matchGroups = new Map<string, ValueBet[]>();
  alta.concat(media).forEach((b) => {
    const key = b.match.id;
    if (!matchGroups.has(key)) matchGroups.set(key, []);
    matchGroups.get(key)!.push(b);
  });
  const parlayMatches = [...matchGroups.entries()].filter(([, bets]) => bets.length >= 2);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Recomendaciones</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Apuestas donde tenemos ventaja sobre las casas — ordenadas por confianza
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <button onClick={() => setFilter(filter === 'alta' ? 'todas' : 'alta')}
          className={`rounded-xl border p-4 text-left transition-colors ${filter === 'alta' ? 'border-emerald-500 bg-emerald-500/10' : 'hover:bg-accent/50'}`}>
          <div className="flex items-center justify-between">
            <Star className="size-4 text-emerald-500" />
            <span className="text-2xl font-bold text-emerald-500">{alta.length}</span>
          </div>
          <div className="text-sm font-medium mt-1">Confianza Alta</div>
          <div className="text-xs text-muted-foreground">Edge &ge; 15%</div>
        </button>
        <button onClick={() => setFilter(filter === 'media' ? 'todas' : 'media')}
          className={`rounded-xl border p-4 text-left transition-colors ${filter === 'media' ? 'border-amber-500 bg-amber-500/10' : 'hover:bg-accent/50'}`}>
          <div className="flex items-center justify-between">
            <Target className="size-4 text-amber-500" />
            <span className="text-2xl font-bold text-amber-500">{media.length}</span>
          </div>
          <div className="text-sm font-medium mt-1">Confianza Media</div>
          <div className="text-xs text-muted-foreground">Edge 7% – 15%</div>
        </button>
        <button onClick={() => setFilter(filter === 'baja' ? 'todas' : 'baja')}
          className={`rounded-xl border p-4 text-left transition-colors ${filter === 'baja' ? 'border-zinc-400 bg-zinc-500/10' : 'hover:bg-accent/50'}`}>
          <div className="flex items-center justify-between">
            <AlertTriangle className="size-4 text-zinc-400" />
            <span className="text-2xl font-bold text-zinc-400">{baja.length}</span>
          </div>
          <div className="text-sm font-medium mt-1">Confianza Baja</div>
          <div className="text-xs text-muted-foreground">Edge 2% – 7%</div>
        </button>
      </div>

      {/* Parlay suggestion */}
      {parlayMatches.length > 0 && filter === 'todas' && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="size-4 text-emerald-500" />
              <span className="text-sm font-semibold">Combinadas sugeridas</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Partidos con múltiples apuestas de valor — ideales para combinadas
            </p>
            <div className="space-y-2">
              {parlayMatches.slice(0, 3).map(([matchId, mBets]) => (
                <div key={matchId} className="rounded-lg bg-background/80 border p-3">
                  <div className="text-sm font-medium">
                    {mBets[0].match.homeTeam.name} vs {mBets[0].match.awayTeam.name}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {mBets.map((b) => (
                      <Badge key={b.id} className={confidenceColor(getConfidence(b.edge ?? 0)) + ' text-[10px]'}>
                        {translateMarket(b.market)}: {translateSelection(b.selection, b.match.homeTeam.name, b.match.awayTeam.name)}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bets list */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Zap className="mx-auto size-8 text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground text-sm">
              {bets.length === 0
                ? 'No hay apuestas de valor ahora. Se generan cuando hay partidos próximos con odds publicadas.'
                : 'No hay apuestas en esta categoría.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((bet) => (
            <BetCard key={bet.id} bet={bet} />
          ))}
        </div>
      )}
    </div>
  );
}

function BetCard({ bet }: { bet: ValueBet }) {
  const edge = bet.edge ?? 0;
  const conf = getConfidence(edge);
  const edgePct = (edge * 100).toFixed(1);
  const modelPct = (bet.modelProbability * 100).toFixed(0);
  const housePct = bet.impliedProbability ? (bet.impliedProbability * 100).toFixed(0) : '—';
  const kickoff = new Date(bet.match.kickoffAt);
  const dateStr = kickoff.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeStr = kickoff.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  const recommendation = translateSelection(bet.selection, bet.match.homeTeam.name, bet.match.awayTeam.name);
  const marketLabel = translateMarket(bet.market);

  return (
    <Card className={`transition-colors ${confidenceBg(conf)}`}>
      <CardContent className="py-4">
        {/* Top row: recommendation + confidence */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* The clear recommendation */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-bold">
                Apuesta: {recommendation}
              </span>
              <Badge className={confidenceColor(conf) + ' text-[10px] font-semibold'}>
                {confidenceLabel(conf)}
              </Badge>
            </div>

            {/* What market */}
            <div className="text-sm text-muted-foreground mt-0.5">
              {marketLabel}
            </div>

            {/* Match info */}
            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
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

          {/* Edge indicator */}
          <div className="text-right shrink-0">
            <div className={`text-xl font-bold ${conf === 'alta' ? 'text-emerald-500' : conf === 'media' ? 'text-amber-500' : 'text-zinc-400'}`}>
              +{edgePct}%
            </div>
            <div className="text-[10px] text-muted-foreground">ventaja</div>
          </div>
        </div>

        {/* Probability comparison bar */}
        <div className="mt-3 rounded-lg bg-muted/50 p-2.5">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-muted-foreground">Nuestro modelo dice <span className="font-semibold text-foreground">{modelPct}%</span></span>
            <span className="text-muted-foreground">La casa dice <span className="font-semibold text-foreground">{housePct}%</span></span>
          </div>
          <div className="relative h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`absolute left-0 top-0 h-full rounded-full ${conf === 'alta' ? 'bg-emerald-500' : conf === 'media' ? 'bg-amber-500' : 'bg-zinc-400'}`}
              style={{ width: `${Math.min(bet.modelProbability * 100, 100)}%` }}
            />
            {bet.impliedProbability && (
              <div
                className="absolute top-0 h-full w-0.5 bg-foreground/60"
                style={{ left: `${Math.min(bet.impliedProbability * 100, 100)}%` }}
              />
            )}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            Modelo: {bet.modelName === 'ensemble_v1' ? '✦ Ensemble (Poisson+Elo)' : bet.modelName === 'poisson_v1' ? 'Poisson' : bet.modelName === 'elo_v1' ? 'Elo' : bet.modelName === 'events_poisson_v1' ? 'Eventos' : bet.modelName === 'player_poisson_v1' ? 'Jugador' : bet.modelName}
          </div>
        </div>

        {/* LLM Explanation */}
        {bet.explanation && (
          <div className="mt-3 rounded-lg bg-blue-500/5 border border-blue-500/20 p-2.5">
            <div className="flex items-center gap-1.5 mb-1">
              <BrainCircuit className="size-3 text-blue-400" />
              <span className="text-[10px] font-medium text-blue-400">Análisis IA</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{bet.explanation}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 bg-muted rounded animate-pulse" />
      <div className="grid gap-3 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
        ))}
      </div>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-32 bg-muted rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <p className="text-destructive text-sm">Error: {message}</p>
        <p className="text-muted-foreground text-xs mt-2">Verifica que la API esté corriendo en localhost:4000</p>
      </CardContent>
    </Card>
  );
}
