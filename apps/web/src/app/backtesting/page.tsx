'use client';

import { useEffect, useState } from 'react';
import { FlaskConical, TrendingUp, Target, BarChart3, Trophy, AlertTriangle, BrainCircuit } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiFetch, type BacktestReport, type ModelReport, type BacktestAnalysisResponse } from '@/lib/api';

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function roiColor(roi: number) {
  if (roi > 0.05) return 'text-emerald-500';
  if (roi > 0) return 'text-emerald-400';
  if (roi > -0.05) return 'text-amber-500';
  return 'text-red-500';
}

function brierLabel(b: number) {
  if (b < 0.5) return { text: 'Excelente', color: 'bg-emerald-500/15 text-emerald-500' };
  if (b < 0.7) return { text: 'Bueno', color: 'bg-emerald-500/10 text-emerald-400' };
  if (b < 0.9) return { text: 'Regular', color: 'bg-amber-500/15 text-amber-500' };
  return { text: 'Pobre', color: 'bg-red-500/15 text-red-500' };
}

export default function BacktestingPage() {
  const [report, setReport] = useState<BacktestReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [loadingAI, setLoadingAI] = useState(false);

  useEffect(() => {
    apiFetch<BacktestReport>('/backtesting')
      .then((r) => {
        setReport(r);
        if (r.models.length > 0) setSelectedModel(r.models[0].model);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <AlertTriangle className="size-8 text-red-500" />
        <p className="text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!report || report.models.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <FlaskConical className="size-8 text-muted-foreground" />
        <p className="text-muted-foreground">No hay datos de backtesting. Se necesitan partidos finalizados con predicciones.</p>
      </div>
    );
  }

  const model = report.models.find((m) => m.model === selectedModel) ?? report.models[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FlaskConical className="size-6 text-emerald-500" />
          Backtesting
        </h1>
        <p className="text-muted-foreground mt-1">
          {report.totalMatchesEvaluated} partidos evaluados &middot; {report.models.length} modelo{report.models.length > 1 ? 's' : ''}
        </p>
      </div>

      {/* AI Meta-Analysis */}
      <Card className="border-blue-500/20">
        <CardContent className="py-4">
          {!aiAnalysis && !loadingAI && (
            <button
              onClick={() => {
                setLoadingAI(true);
                apiFetch<BacktestAnalysisResponse>('/analysis/backtesting')
                  .then((r) => setAiAnalysis(r.content))
                  .catch(() => setAiAnalysis('No se pudo generar el análisis.'))
                  .finally(() => setLoadingAI(false));
              }}
              className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              <BrainCircuit className="size-4" />
              Generar meta-análisis IA de los modelos
            </button>
          )}
          {loadingAI && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400" />
              Analizando métricas de backtesting...
            </div>
          )}
          {aiAnalysis && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <BrainCircuit className="size-4 text-blue-400" />
                <span className="text-sm font-semibold text-blue-400">Meta-análisis IA</span>
              </div>
              <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{aiAnalysis}</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Model selector */}
      {report.models.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {report.models.map((m) => (
            <button
              key={m.model}
              onClick={() => setSelectedModel(m.model)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedModel === m.model
                  ? 'bg-emerald-500 text-white'
                  : 'bg-card border border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {m.model}
              <span className="ml-2 opacity-75">{pct(m.accuracy)}</span>
            </button>
          ))}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Target className="size-4" />
              Accuracy
            </div>
            <div className="text-2xl font-bold">{pct(model.accuracy)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {model.correctPredictions}/{Math.round(model.totalPredictions / 3)} partidos
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <BarChart3 className="size-4" />
              Brier Score
            </div>
            <div className="text-2xl font-bold">{model.brierScore.toFixed(3)}</div>
            <Badge variant="outline" className={`mt-1 text-xs ${brierLabel(model.brierScore).color}`}>
              {brierLabel(model.brierScore).text}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <TrendingUp className="size-4" />
              ROI (Value Bets)
            </div>
            <div className={`text-2xl font-bold ${roiColor(model.valueBetROI.roi)}`}>
              {model.valueBetROI.roi >= 0 ? '+' : ''}{pct(model.valueBetROI.roi)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {model.valueBetROI.totalBets} apuestas simuladas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Trophy className="size-4" />
              Win Rate (VB)
            </div>
            <div className="text-2xl font-bold">{pct(model.valueBetROI.winRate)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              ${model.valueBetROI.totalReturn.toFixed(0)} retorno / ${model.valueBetROI.totalStaked} apostado
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Calibration Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calibración del modelo</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Un modelo bien calibrado tiene barras azules (predicción) y verdes (realidad) de tamaño similar.
          </p>
          <div className="space-y-2">
            {model.calibration.filter((b) => b.count > 0).map((bucket) => (
              <div key={bucket.range} className="flex items-center gap-3 text-sm">
                <span className="w-16 text-right text-muted-foreground font-mono text-xs">{bucket.range}</span>
                <div className="flex-1 flex gap-1 items-center">
                  {/* Predicted bar */}
                  <div className="flex-1 relative h-5">
                    <div
                      className="absolute inset-y-0 left-0 bg-blue-500/30 rounded"
                      style={{ width: `${Math.max(bucket.predicted * 100, 2)}%` }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 bg-emerald-500/50 rounded"
                      style={{ width: `${Math.max(bucket.actual * 100, 2)}%` }}
                    />
                  </div>
                </div>
                <span className="w-10 text-right font-mono text-xs text-blue-400">{pct(bucket.predicted)}</span>
                <span className="w-10 text-right font-mono text-xs text-emerald-400">{pct(bucket.actual)}</span>
                <span className="w-8 text-right text-muted-foreground text-xs">n={bucket.count}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500/30" /> Predicho</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/50" /> Real</span>
          </div>
        </CardContent>
      </Card>

      {/* League Breakdown */}
      {model.byLeague.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Desglose por liga</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 font-medium">Liga</th>
                    <th className="text-right py-2 font-medium">Partidos</th>
                    <th className="text-right py-2 font-medium">Accuracy</th>
                    <th className="text-right py-2 font-medium">Brier</th>
                  </tr>
                </thead>
                <tbody>
                  {model.byLeague
                    .sort((a, b) => b.accuracy - a.accuracy)
                    .map((lg) => (
                      <tr key={lg.leagueId} className="border-b border-border/50">
                        <td className="py-2 font-medium">{lg.league}</td>
                        <td className="py-2 text-right text-muted-foreground">{lg.matches}</td>
                        <td className="py-2 text-right">
                          <span className={lg.accuracy >= 0.5 ? 'text-emerald-500' : lg.accuracy >= 0.35 ? 'text-amber-500' : 'text-red-500'}>
                            {pct(lg.accuracy)}
                          </span>
                        </td>
                        <td className="py-2 text-right font-mono text-muted-foreground">{lg.brierScore.toFixed(3)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Model comparison (if multiple) */}
      {report.models.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Comparación de modelos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 font-medium">Modelo</th>
                    <th className="text-right py-2 font-medium">Accuracy</th>
                    <th className="text-right py-2 font-medium">Brier</th>
                    <th className="text-right py-2 font-medium">ROI</th>
                    <th className="text-right py-2 font-medium">Win Rate</th>
                    <th className="text-right py-2 font-medium">VB Apuestas</th>
                  </tr>
                </thead>
                <tbody>
                  {report.models.map((m) => (
                    <tr
                      key={m.model}
                      className={`border-b border-border/50 cursor-pointer transition-colors hover:bg-accent/50 ${
                        m.model === selectedModel ? 'bg-accent/30' : ''
                      }`}
                      onClick={() => setSelectedModel(m.model)}
                    >
                      <td className="py-2 font-medium">{m.model}</td>
                      <td className="py-2 text-right">{pct(m.accuracy)}</td>
                      <td className="py-2 text-right font-mono">{m.brierScore.toFixed(3)}</td>
                      <td className={`py-2 text-right font-medium ${roiColor(m.valueBetROI.roi)}`}>
                        {m.valueBetROI.roi >= 0 ? '+' : ''}{pct(m.valueBetROI.roi)}
                      </td>
                      <td className="py-2 text-right">{pct(m.valueBetROI.winRate)}</td>
                      <td className="py-2 text-right text-muted-foreground">{m.valueBetROI.totalBets}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground text-right">
        Generado: {new Date(report.generatedAt).toLocaleString('es-CO')}
      </p>
    </div>
  );
}
