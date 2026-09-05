'use client';

import { useEffect, useState, useCallback } from 'react';
import { Search, Users, ChevronRight, TrendingUp, Target, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiFetch, type PlayerSummary, type PlayerDetail, type TopPlayer } from '@/lib/api';
import { buildPropSuggestions } from '@edgeiq/shared';

export default function PlayersPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlayerSummary[]>([]);
  const [topPlayers, setTopPlayers] = useState<TopPlayer[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<TopPlayer[]>('/players/top?stat=goals&limit=10').then(setTopPlayers).catch(() => {});
  }, []);

  const search = useCallback(() => {
    if (query.length < 2) return;
    setLoading(true);
    apiFetch<PlayerSummary[]>(`/players/search?q=${encodeURIComponent(query)}`)
      .then(setResults)
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [query]);

  const selectPlayer = (id: string) => {
    apiFetch<PlayerDetail>(`/players/${id}`).then(setSelectedPlayer).catch(() => {});
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Jugadores</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Busca un jugador para ver qué props tienen buena probabilidad
        </p>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar jugador por nombre..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            className="w-full rounded-lg border bg-background px-10 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <Button onClick={search} disabled={query.length < 2}>
          Buscar
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Search results or top players */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {results.length > 0 ? `Resultados (${results.length})` : 'Top Goleadores'}
          </h2>

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />)}
            </div>
          ) : results.length > 0 ? (
            results.map((p) => (
              <button
                key={p.id}
                onClick={() => selectPlayer(p.id)}
                className="w-full flex items-center justify-between rounded-lg border bg-card p-3 text-left hover:bg-accent/50 transition-colors"
              >
                <div>
                  <div className="font-medium text-sm">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.team?.name ?? 'Sin equipo'}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">{p._count.matchStats} partidos</Badge>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </button>
            ))
          ) : (
            topPlayers.map((tp, i) => (
              <button
                key={tp.player.id}
                onClick={() => selectPlayer(tp.player.id)}
                className="w-full flex items-center justify-between rounded-lg border bg-card p-3 text-left hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-muted-foreground w-5">{i + 1}</span>
                  <div>
                    <div className="font-medium text-sm">{tp.player.name}</div>
                    <div className="text-xs text-muted-foreground">{tp.player.team?.name ?? ''}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{tp.total} goles</span>
                  <span className="text-xs text-muted-foreground">({tp.matches} PJ)</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </button>
            ))
          )}
        </div>

        {/* Player detail */}
        <div>
          {selectedPlayer ? (
            <PlayerDetailCard player={selectedPlayer} />
          ) : (
            <Card>
              <CardContent className="py-16 text-center">
                <Users className="mx-auto size-8 text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground text-sm">Selecciona un jugador para ver sus props sugeridos</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function PlayerDetailCard({ player }: { player: PlayerDetail }) {
  const avg = player.averages;
  const suggestions = buildPropSuggestions(avg);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{player.name}</span>
          <Badge variant="outline">{player.team?.name ?? 'Sin equipo'}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Active injuries/suspensions */}
        {player.injuries && player.injuries.length > 0 && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="size-4 text-red-500" />
              <span className="text-sm font-semibold text-red-500">
                {player.injuries.some((i) => i.type?.toLowerCase().includes('suspen')) ? 'Sancionado' : 'Lesionado'}
              </span>
            </div>
            {player.injuries.map((inj) => (
              <div key={inj.id} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{inj.reason}</span>
                {' · '}
                {new Date(inj.reportedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
              </div>
            ))}
          </div>
        )}

        {/* Prop suggestions - the most actionable part */}
        {suggestions.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Target className="size-4 text-emerald-500" />
              <span className="text-sm font-semibold">Props sugeridos</span>
            </div>
            <div className="space-y-2">
              {suggestions.map((s, i) => {
                const pct = (s.probability * 100).toFixed(0);
                const color = s.probability >= 0.6 ? 'text-emerald-500' : s.probability >= 0.4 ? 'text-amber-500' : 'text-zinc-400';
                const barColor = s.probability >= 0.6 ? 'bg-emerald-500' : s.probability >= 0.4 ? 'bg-amber-500' : 'bg-zinc-400';
                return (
                  <div key={i} className="rounded-lg bg-muted/50 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{s.label}</span>
                      <span className={`text-sm font-bold ${color}`}>{pct}%</span>
                    </div>
                    <div className="relative h-1.5 rounded-full bg-muted overflow-hidden mb-1">
                      <div className={`absolute left-0 top-0 h-full rounded-full ${barColor}`}
                        style={{ width: `${Math.min(s.probability * 100, 100)}%` }} />
                    </div>
                    <div className="text-[10px] text-muted-foreground">{s.description}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {avg ? (
          <>
            {/* Averages grid - simplified */}
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Promedios ({avg.matchesPlayed} partidos con 45+ min)
              </div>
              <div className="grid grid-cols-3 gap-2">
                <StatBox label="Goles" value={avg.goals.toFixed(2)} highlight={avg.goals >= 0.4} />
                <StatBox label="Asistencias" value={avg.assists.toFixed(2)} highlight={avg.assists >= 0.3} />
                <StatBox label="Tiros a puerta" value={avg.shotsOn.toFixed(2)} highlight={avg.shotsOn >= 1.5} />
                <StatBox label="Tiros totales" value={avg.shotsTotal.toFixed(2)} highlight={avg.shotsTotal >= 2.5} />
                <StatBox label="Tarjetas" value={avg.yellowCards.toFixed(2)} highlight={avg.yellowCards >= 0.4} />
                <StatBox label="Minutos" value={avg.minutes.toFixed(0)} highlight={false} />
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Menos de 5 partidos con 45+ minutos. Sin datos suficientes.
          </p>
        )}

        {/* Recent matches table */}
        {player.recentMatches.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Últimos partidos
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-1.5 text-left font-medium">Partido</th>
                    <th className="py-1.5 text-center font-medium">Min</th>
                    <th className="py-1.5 text-center font-medium">G</th>
                    <th className="py-1.5 text-center font-medium">A</th>
                    <th className="py-1.5 text-center font-medium">SOT</th>
                    <th className="py-1.5 text-center font-medium">TS</th>
                    <th className="py-1.5 text-center font-medium">YC</th>
                  </tr>
                </thead>
                <tbody>
                  {player.recentMatches.map((m) => (
                    <tr key={m.matchId} className="border-b border-border/50">
                      <td className="py-1.5">
                        <div className="truncate max-w-[160px]">{m.opponent}</div>
                        <div className="text-muted-foreground">{new Date(m.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</div>
                      </td>
                      <td className="py-1.5 text-center">{m.minutes}</td>
                      <td className="py-1.5 text-center font-medium">{m.goals || '—'}</td>
                      <td className="py-1.5 text-center">{m.assists || '—'}</td>
                      <td className="py-1.5 text-center">{m.shotsOn || '—'}</td>
                      <td className="py-1.5 text-center">{m.shotsTotal || '—'}</td>
                      <td className="py-1.5 text-center">{m.yellowCards || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatBox({ label, value, highlight }: { label: string; value: string; highlight: boolean }) {
  return (
    <div className={`rounded-lg p-2.5 text-center ${highlight ? 'bg-emerald-500/10 ring-1 ring-emerald-500/20' : 'bg-muted/50'}`}>
      <div className={`text-lg font-bold ${highlight ? 'text-emerald-500' : ''}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
