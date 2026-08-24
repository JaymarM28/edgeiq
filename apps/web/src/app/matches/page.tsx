'use client';

import { useEffect, useState } from 'react';
import { BarChart3, ChevronDown, ChevronUp, Star, Target, Zap, AlertTriangle, BrainCircuit } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiFetch, type UpcomingMatch, type League, type Prediction, type MatchAnalysisResponse } from '@/lib/api';

type Tip = { text: string; edge: number; confidence: 'alta' | 'media' | 'baja'; market: string };

function buildTips(match: UpcomingMatch): Tip[] {
  const tips: Tip[] = [];

  for (const p of match.predictions) {
    if (!p.edge || p.edge <= 0.02 || p.edge > 2.0) continue;

    const conf = p.edge >= 0.15 ? 'alta' as const : p.edge >= 0.07 ? 'media' as const : 'baja' as const;

    let text = '';
    if (p.market === '1X2') {
      const sel = p.selection === 'Home' ? `Gana ${match.homeTeam.name}` : p.selection === 'Away' ? `Gana ${match.awayTeam.name}` : 'Empate';
      text = sel;
    } else if (p.market.startsWith('O/U')) {
      const parts = p.market.replace('O/U ', '').split(' ');
      const stat = parts[0];
      const team = parts.slice(1).join(' ');
      const statMap: Record<string, string> = {
        corners: 'Córners', shots_total: 'Tiros totales', shots_on: 'Tiros a puerta',
        fouls: 'Faltas', yellow_cards: 'Tarjetas',
      };
      const dir = p.selection === 'Over' ? 'Más' : 'Menos';
      text = `${dir} ${statMap[stat] ?? stat} (${team})`;
    } else {
      text = `${p.market}: ${p.selection}`;
    }

    tips.push({ text, edge: p.edge, confidence: conf, market: p.market });
  }

  return tips.sort((a, b) => b.edge - a.edge);
}

function confColor(c: 'alta' | 'media' | 'baja') {
  return c === 'alta' ? 'text-emerald-500' : c === 'media' ? 'text-amber-500' : 'text-zinc-400';
}

function confBadge(c: 'alta' | 'media' | 'baja') {
  return c === 'alta'
    ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
    : c === 'media'
      ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
      : 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30';
}

export default function MatchesPage() {
  const [matches, setMatches] = useState<UpcomingMatch[]>([]);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [selectedLeague, setSelectedLeague] = useState('');
  const [loading, setLoading] = useState(true);
  const [onlyValue, setOnlyValue] = useState(false);

  useEffect(() => {
    apiFetch<League[]>('/leagues').then(setLeagues).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const q = selectedLeague ? `?leagueId=${selectedLeague}` : '';
    apiFetch<UpcomingMatch[]>(`/matches/upcoming${q}`)
      .then(setMatches)
      .catch(() => setMatches([]))
      .finally(() => setLoading(false));
  }, [selectedLeague]);

  const withTips = matches.map((m) => ({ match: m, tips: buildTips(m) }));
  const displayed = onlyValue ? withTips.filter((x) => x.tips.length > 0) : withTips;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Partidos</h1>
        <p className="text-muted-foreground text-sm mt-1">Próximos partidos con recomendaciones de apuesta</p>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <Button variant={selectedLeague === '' ? 'default' : 'outline'} size="sm" onClick={() => setSelectedLeague('')}>
          Todas
        </Button>
        {leagues.map((l) => (
          <Button key={l.id} variant={selectedLeague === l.id ? 'default' : 'outline'} size="sm"
            onClick={() => setSelectedLeague(l.id)}>
            {l.name}
          </Button>
        ))}
        <div className="w-px h-6 bg-border mx-1" />
        <Button variant={onlyValue ? 'default' : 'outline'} size="sm" onClick={() => setOnlyValue(!onlyValue)}>
          <Zap className="size-3 mr-1" /> Solo con valor
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : displayed.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BarChart3 className="mx-auto size-8 text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground text-sm">
              {onlyValue ? 'No hay partidos con valor detectado' : 'No hay partidos programados'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {displayed.map(({ match, tips }) => (
            <MatchCard key={match.id} match={match} tips={tips} />
          ))}
        </div>
      )}
    </div>
  );
}

function MatchCard({ match, tips }: { match: UpcomingMatch; tips: Tip[] }) {
  const [expanded, setExpanded] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const kickoff = new Date(match.kickoffAt);
  const dateStr = kickoff.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeStr = kickoff.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  const ensemble1x2 = match.predictions.filter((p) => p.modelName === 'ensemble_v1' && p.market === '1X2');
  const poisson1x2 = match.predictions.filter((p) => p.modelName === 'poisson_v1' && p.market === '1X2');
  const elo1x2 = match.predictions.filter((p) => p.modelName === 'elo_v1' && p.market === '1X2');

  // Prefer ensemble, fall back to poisson
  const primary1x2 = ensemble1x2.length > 0 ? ensemble1x2 : poisson1x2;
  const primaryLabel = ensemble1x2.length > 0 ? 'Ensemble' : 'Poisson';

  // Find the most likely 1X2 outcome
  const bestPred = primary1x2.reduce<Prediction | null>((best, p) => !best || p.modelProbability > best.modelProbability ? p : best, null);
  const eloBest = elo1x2.reduce<Prediction | null>((best, p) => !best || p.modelProbability > best.modelProbability ? p : best, null);
  const modelsAgree = bestPred && eloBest && bestPred.selection === eloBest.selection;

  const topTips = tips.slice(0, 3);
  const moreTips = tips.length > 3 ? tips.slice(3) : [];

  const hasTips = tips.length > 0;

  return (
    <Card className={hasTips ? 'border-emerald-500/20' : ''}>
      <CardContent className="py-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-center min-w-[50px]">
              <div className="text-xs text-muted-foreground">{dateStr}</div>
              <div className="text-sm font-semibold">{timeStr}</div>
            </div>
            <div>
              <div className="font-medium">{match.homeTeam.name} vs {match.awayTeam.name}</div>
              <div className="text-xs text-muted-foreground">
                {match.league.name} {match.matchday ? `· J${match.matchday}` : ''}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
        </div>

        {/* Quick prediction summary */}
        {bestPred && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Predicción:</span>
            <span className="font-semibold">
              {bestPred.selection === 'Home' ? match.homeTeam.name : bestPred.selection === 'Away' ? match.awayTeam.name : 'Empate'}
            </span>
            <span className="text-muted-foreground">({(bestPred.modelProbability * 100).toFixed(0)}%)</span>
            {ensemble1x2.length > 0 ? (
              <Badge className="bg-blue-500/15 text-blue-500 border-blue-500/30 text-[10px]">
                Ensemble
              </Badge>
            ) : modelsAgree ? (
              <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30 text-[10px]">
                Poisson + Elo coinciden
              </Badge>
            ) : null}
          </div>
        )}

        {/* Value bet tips */}
        {topTips.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              Apuestas recomendadas
            </div>
            {topTips.map((tip, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                <div className="flex items-center gap-2">
                  {tip.confidence === 'alta' ? <Star className="size-3 text-emerald-500" /> : <Target className="size-3 text-amber-500" />}
                  <span className="text-sm font-medium">{tip.text}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${confColor(tip.confidence)}`}>+{(tip.edge * 100).toFixed(1)}%</span>
                  <Badge className={confBadge(tip.confidence) + ' text-[9px]'}>
                    {tip.confidence === 'alta' ? 'Alta' : tip.confidence === 'media' ? 'Media' : 'Baja'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Expanded details */}
        {expanded && (
          <div className="mt-4 space-y-3 border-t pt-3">
            {/* AI Full Analysis */}
            <div>
              {!analysis && !loadingAnalysis && (
                <button
                  onClick={() => {
                    setLoadingAnalysis(true);
                    apiFetch<MatchAnalysisResponse>(`/analysis/match/${match.id}/pre`)
                      .then((r) => setAnalysis(r.content))
                      .catch(() => setAnalysis('No se pudo generar el análisis.'))
                      .finally(() => setLoadingAnalysis(false));
                  }}
                  className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <BrainCircuit className="size-3" />
                  Generar análisis IA completo
                </button>
              )}
              {loadingAnalysis && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="animate-spin rounded-full h-3 w-3 border-b border-blue-400" />
                  Analizando datos del partido...
                </div>
              )}
              {analysis && (
                <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <BrainCircuit className="size-3.5 text-blue-400" />
                    <span className="text-xs font-semibold text-blue-400">Análisis IA del partido</span>
                  </div>
                  <div className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{analysis}</div>
                </div>
              )}
            </div>

            {/* 1X2 probabilities */}
            {poisson1x2.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Probabilidades 1X2
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {['Home', 'Draw', 'Away'].map((sel) => {
                    const poisson = poisson1x2.find((p) => p.selection === sel);
                    const elo = elo1x2.find((p) => p.selection === sel);
                    const label = sel === 'Home' ? match.homeTeam.name.split(' ').pop() : sel === 'Away' ? match.awayTeam.name.split(' ').pop() : 'Empate';
                    return (
                      <div key={sel} className="text-center rounded-lg bg-muted/50 py-2 px-1">
                        <div className="text-[10px] text-muted-foreground">{label}</div>
                        <div className="text-sm font-semibold mt-0.5">
                          {poisson ? `${(poisson.modelProbability * 100).toFixed(0)}%` : '—'}
                        </div>
                        {elo && (
                          <div className="text-[10px] text-muted-foreground">
                            Elo: {(elo.modelProbability * 100).toFixed(0)}%
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* LLM Explanations for value bets */}
            {(() => {
              const explanations = match.predictions.filter((p) => p.explanation);
              if (explanations.length === 0) return null;
              return (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <BrainCircuit className="size-3 text-blue-400" />
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Análisis IA</span>
                  </div>
                  <div className="space-y-2">
                    {explanations.map((p, i) => (
                      <div key={i} className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-2.5">
                        <div className="text-[10px] text-blue-400 font-medium mb-0.5">
                          {p.market === '1X2'
                            ? (p.selection === 'Home' ? match.homeTeam.name : p.selection === 'Away' ? match.awayTeam.name : 'Empate')
                            : `${p.market}: ${p.selection}`}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{p.explanation}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* More tips if any */}
            {moreTips.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Más oportunidades
                </div>
                {moreTips.map((tip, i) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1">
                    <span>{tip.text}</span>
                    <span className={`font-semibold ${confColor(tip.confidence)}`}>+{(tip.edge * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            )}

            {/* Injuries */}
            {match.injuries && (match.injuries.home.length > 0 || match.injuries.away.length > 0) && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertTriangle className="size-3 text-red-500" />
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Bajas</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-1">{match.homeTeam.name}</div>
                    {match.injuries.home.length === 0 ? (
                      <div className="text-[10px] text-muted-foreground/50">Sin bajas</div>
                    ) : (
                      match.injuries.home.map((inj, i) => (
                        <div key={i} className="text-xs flex items-center gap-1 py-0.5">
                          <span className={`size-1.5 rounded-full shrink-0 ${inj.type?.toLowerCase().includes('suspen') ? 'bg-amber-500' : 'bg-red-500'}`} />
                          <span className="truncate">{inj.player.name}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">({inj.reason})</span>
                        </div>
                      ))
                    )}
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground mb-1">{match.awayTeam.name}</div>
                    {match.injuries.away.length === 0 ? (
                      <div className="text-[10px] text-muted-foreground/50">Sin bajas</div>
                    ) : (
                      match.injuries.away.map((inj, i) => (
                        <div key={i} className="text-xs flex items-center gap-1 py-0.5">
                          <span className={`size-1.5 rounded-full shrink-0 ${inj.type?.toLowerCase().includes('suspen') ? 'bg-amber-500' : 'bg-red-500'}`} />
                          <span className="truncate">{inj.player.name}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">({inj.reason})</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* No tips */}
            {tips.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Sin apuestas de valor detectadas en este partido.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
