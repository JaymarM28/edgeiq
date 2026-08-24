'use client';

import { useState, useCallback } from 'react';
import { Search, Shield, ChevronRight, CalendarClock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiFetch, type TeamSearchResult, type TeamDetail } from '@/lib/api';

const OUTCOME_STYLES: Record<'W' | 'D' | 'L', string> = {
  W: 'bg-emerald-500/15 text-emerald-500',
  D: 'bg-amber-500/15 text-amber-500',
  L: 'bg-red-500/15 text-red-500',
};

export default function TeamsPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TeamSearchResult[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<TeamDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const search = useCallback(() => {
    if (query.length < 2) return;
    setLoading(true);
    apiFetch<TeamSearchResult[]>(`/teams/search?q=${encodeURIComponent(query)}`)
      .then(setResults)
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [query]);

  const selectTeam = (id: string) => {
    apiFetch<TeamDetail>(`/teams/${id}`).then(setSelectedTeam).catch(() => {});
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Equipos</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Busca un equipo para ver su forma reciente y próximos partidos
        </p>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar equipo por nombre..."
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
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Resultados {results.length > 0 && `(${results.length})`}
          </h2>

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />
              ))}
            </div>
          ) : results.length > 0 ? (
            results.map((t) => (
              <button
                key={t.id}
                onClick={() => selectTeam(t.id)}
                className="w-full flex items-center justify-between rounded-lg border bg-card p-3 text-left hover:bg-accent/50 transition-colors"
              >
                <div>
                  <div className="font-medium text-sm">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.country ?? 'País desconocido'}</div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </button>
            ))
          ) : (
            <Card>
              <CardContent className="py-10 text-center">
                <Shield className="mx-auto size-8 text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground text-sm">Busca un equipo para empezar</p>
              </CardContent>
            </Card>
          )}
        </div>

        <div>
          {selectedTeam ? (
            <TeamDetailCard detail={selectedTeam} />
          ) : (
            <Card>
              <CardContent className="py-16 text-center">
                <Shield className="mx-auto size-8 text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground text-sm">Selecciona un equipo para ver su detalle</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function TeamDetailCard({ detail }: { detail: TeamDetail }) {
  const { team, record, recentForm, upcomingMatches } = detail;
  const winPct = record.matchesPlayed > 0 ? (record.wins / record.matchesPlayed) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{team.name}</span>
          {team.country && <Badge variant="outline">{team.country}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Record */}
        <div className="grid grid-cols-4 gap-2">
          <StatBox label="PJ" value={record.matchesPlayed} />
          <StatBox label="G-E-P" value={`${record.wins}-${record.draws}-${record.losses}`} />
          <StatBox label="GF" value={record.goalsFor} />
          <StatBox label="GC" value={record.goalsAgainst} />
        </div>

        {record.matchesPlayed > 0 && (
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>% de victorias</span>
              <span>{winPct.toFixed(0)}%</span>
            </div>
            <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="absolute left-0 top-0 h-full rounded-full bg-emerald-500"
                style={{ width: `${winPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Recent form */}
        {recentForm.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Forma reciente
            </div>
            <div className="flex gap-1 mb-3">
              {recentForm.map((f) => (
                <span
                  key={f.matchId}
                  title={`${f.isHome ? 'vs' : '@'} ${f.opponent} (${f.scored}-${f.conceded})`}
                  className={`flex size-6 items-center justify-center rounded text-[10px] font-bold ${OUTCOME_STYLES[f.outcome]}`}
                >
                  {f.outcome}
                </span>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-1.5 text-left font-medium">Rival</th>
                    <th className="py-1.5 text-center font-medium">Resultado</th>
                    <th className="py-1.5 text-center font-medium">Liga</th>
                  </tr>
                </thead>
                <tbody>
                  {recentForm.map((f) => (
                    <tr key={f.matchId} className="border-b border-border/50">
                      <td className="py-1.5">
                        <span className="text-muted-foreground mr-1">{f.isHome ? 'vs' : '@'}</span>
                        {f.opponent}
                      </td>
                      <td className="py-1.5 text-center font-medium">
                        {f.scored}-{f.conceded}
                      </td>
                      <td className="py-1.5 text-center text-muted-foreground">{f.league}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Upcoming matches */}
        {upcomingMatches.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CalendarClock className="size-4 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Próximos partidos
              </span>
            </div>
            <div className="space-y-1.5">
              {upcomingMatches.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-lg bg-muted/50 p-2.5 text-xs">
                  <span>
                    {m.homeTeam.name} vs {m.awayTeam.name}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(m.kickoffAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2.5 text-center">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
