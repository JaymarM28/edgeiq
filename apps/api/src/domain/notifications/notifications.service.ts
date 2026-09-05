import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { DailyDigest } from './digest.service';

export interface ValueBetAlert {
  match: string; // "Real Madrid vs Barcelona"
  league: string;
  kickoff: string; // "sáb 23 ago · 16:00"
  recommendation: string; // "Gana Real Madrid"
  market: string; // "Resultado"
  edge: number; // 0.18
  modelPct: number; // 0.62
  housePct: number; // 0.45
  confidence: 'alta' | 'media';
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly resend: Resend | null;
  private readonly emailFrom: string;
  private readonly notifyEmail: string | null;
  private readonly callmebotPhone: string | null;
  private readonly callmebotKey: string | null;

  constructor(private readonly config: ConfigService) {
    const resendKey = this.config.get<string>('RESEND_API_KEY');
    this.resend = resendKey ? new Resend(resendKey) : null;
    this.emailFrom = this.config.get<string>(
      'EMAIL_FROM',
      'EdgeIQ <noreply@example.com>',
    );
    this.notifyEmail = this.config.get<string>('NOTIFY_EMAIL') ?? null;
    this.callmebotPhone = this.config.get<string>('CALLMEBOT_PHONE') ?? null;
    this.callmebotKey = this.config.get<string>('CALLMEBOT_API_KEY') ?? null;

    if (!this.resend)
      this.logger.warn('RESEND_API_KEY no configurado — email deshabilitado');
    if (!this.callmebotKey)
      this.logger.warn(
        'CALLMEBOT_API_KEY no configurado — WhatsApp deshabilitado',
      );
  }

  /**
   * Alerta de value bets por WhatsApp únicamente. El email diario ahora lo
   * cubre `sendDailyDigest` (partidos + props, sin el framing de edge que
   * genera falsos positivos con pocos datos — ver docs/DECISIONS.md).
   * `email` en el resultado queda fijo en `false`; se conserva en la firma
   * para no romper a `sendTest`.
   */
  async notifyValueBets(
    bets: ValueBetAlert[],
  ): Promise<{ email: boolean; whatsapp: boolean }> {
    const alta = bets.filter((b) => b.confidence === 'alta');
    if (alta.length === 0) {
      this.logger.log('No hay value bets de confianza alta — sin notificación');
      return { email: false, whatsapp: false };
    }

    const whatsapp = await this.sendWhatsApp(bets);
    return { email: false, whatsapp };
  }

  /** Envía un mensaje de prueba por ambos canales. */
  async sendTest(): Promise<{ email: boolean; whatsapp: boolean }> {
    const testBets: ValueBetAlert[] = [
      {
        match: 'Equipo A vs Equipo B',
        league: 'Liga de prueba',
        kickoff: 'hoy · 20:00',
        recommendation: 'Gana Equipo A',
        market: 'Resultado',
        edge: 0.22,
        modelPct: 0.65,
        housePct: 0.43,
        confidence: 'alta',
      },
    ];

    const [email, whatsapp] = await Promise.allSettled([
      this.sendEmail(testBets),
      this.sendWhatsApp(testBets),
    ]);

    return {
      email: email.status === 'fulfilled' && email.value,
      whatsapp: whatsapp.status === 'fulfilled' && whatsapp.value,
    };
  }

  /** Envía un email transaccional genérico (reset de password, etc.). */
  async sendTransactionalEmail(
    to: string,
    subject: string,
    html: string,
  ): Promise<boolean> {
    if (!this.resend) {
      this.logger.warn(
        'Resend no configurado — no se puede enviar email transaccional',
      );
      return false;
    }
    try {
      await this.resend.emails.send({
        from: this.emailFrom,
        to,
        subject,
        html,
      });
      this.logger.log(`Email transaccional enviado a ${to}: ${subject}`);
      return true;
    } catch (err) {
      this.logger.error('Error enviando email transaccional', err);
      return false;
    }
  }

  // ── Digest diario (partidos + props de jugadores) ──

  /**
   * Envía el resumen diario a `NOTIFY_EMAIL`. A diferencia de las alertas
   * de value bet (edge vs. casa), esto muestra directamente la
   * recomendación del modelo y probabilidades de props — mismo criterio
   * que usan las páginas /matches y /players (ver docs/DECISIONS.md:
   * edges de 100%+ en arranque de temporada no son confiables).
   */
  async sendDailyDigest(digest: DailyDigest): Promise<boolean> {
    if (!this.resend || !this.notifyEmail) return false;
    if (digest.matches.length === 0 && digest.props.length === 0) {
      this.logger.log('Digest diario sin contenido — sin notificación');
      return false;
    }

    try {
      await this.resend.emails.send({
        from: this.emailFrom,
        to: this.notifyEmail,
        subject: `EdgeIQ: resumen del día (${digest.matches.length} partidos, ${digest.props.length} props)`,
        html: this.dailyDigestTemplate(digest),
      });
      this.logger.log(`Digest diario enviado a ${this.notifyEmail}`);
      return true;
    } catch (err) {
      this.logger.error('Error enviando digest diario', err);
      return false;
    }
  }

  /** Escapa texto de origen externo (nombres ingeridos de API-Football)
   * antes de interpolarlo en HTML — evita romper el layout o inyectar
   * markup si el dato trae '&', '<', '>' o comillas. */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private dailyDigestTemplate(digest: DailyDigest): string {
    const esc = (text: string) => this.escapeHtml(text);

    const matchRow = (m: DailyDigest['matches'][number]) => `
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:12px 0">
          <div style="font-weight:600;color:#111827">${esc(m.recommendation)}</div>
          <div style="font-size:13px;color:#6b7280">${esc(m.homeTeam)} vs ${esc(m.awayTeam)} · ${esc(m.league)}</div>
          <div style="font-size:12px;color:#9ca3af">${new Date(m.kickoffAt).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })} · ${new Date(m.kickoffAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</div>
        </td>
        <td style="padding:12px 0;text-align:right">
          <div style="font-weight:700;color:#10b981;font-size:18px">${(m.probability * 100).toFixed(0)}%</div>
        </td>
      </tr>`;

    const propRow = (p: DailyDigest['props'][number]) => `
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:12px 0">
          <div style="font-weight:600;color:#111827">${esc(p.playerName)} — ${esc(p.label)}</div>
          <div style="font-size:13px;color:#6b7280">${p.teamName ? esc(p.teamName) : ''}</div>
          <div style="font-size:12px;color:#9ca3af">${esc(p.description)}</div>
        </td>
        <td style="padding:12px 0;text-align:right">
          <div style="font-weight:700;color:#10b981;font-size:18px">${(p.probability * 100).toFixed(0)}%</div>
        </td>
      </tr>`;

    return `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#0f172a;padding:24px 32px">
          <h2 style="color:#f8fafc;margin:0;font-size:18px">EdgeIQ — Resumen del día</h2>
        </div>
        <div style="padding:24px 32px;background:#fff">
          ${
            digest.matches.length > 0
              ? `
            <h3 style="color:#10b981;font-size:14px;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px">
              Partidos destacados (${digest.matches.length})
            </h3>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
              ${digest.matches.map(matchRow).join('')}
            </table>
          `
              : ''
          }
          ${
            digest.props.length > 0
              ? `
            <h3 style="color:#10b981;font-size:14px;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px">
              Props de jugadores (${digest.props.length})
            </h3>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              ${digest.props.map(propRow).join('')}
            </table>
          `
              : ''
          }
          <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;text-align:center">
            Generado por EdgeIQ · Las apuestas siempre conllevan riesgo
          </p>
        </div>
      </div>
    `;
  }

  // ── Email (Resend) ──

  private async sendEmail(bets: ValueBetAlert[]): Promise<boolean> {
    if (!this.resend || !this.notifyEmail) return false;

    const alta = bets.filter((b) => b.confidence === 'alta');
    const media = bets.filter((b) => b.confidence === 'media');

    try {
      await this.resend.emails.send({
        from: this.emailFrom,
        to: this.notifyEmail,
        subject: `EdgeIQ: ${alta.length} value bet${alta.length > 1 ? 's' : ''} de alta confianza`,
        html: this.emailTemplate(alta, media),
      });
      this.logger.log(
        `Email enviado a ${this.notifyEmail} (${bets.length} bets)`,
      );
      return true;
    } catch (err) {
      this.logger.error('Error enviando email', err);
      return false;
    }
  }

  private emailTemplate(alta: ValueBetAlert[], media: ValueBetAlert[]): string {
    const betRow = (b: ValueBetAlert) => `
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:12px 0">
          <div style="font-weight:600;color:#111827">${b.recommendation}</div>
          <div style="font-size:13px;color:#6b7280">${b.match} · ${b.league}</div>
          <div style="font-size:12px;color:#9ca3af">${b.kickoff} · ${b.market}</div>
        </td>
        <td style="padding:12px 0;text-align:right">
          <div style="font-weight:700;color:${b.confidence === 'alta' ? '#10b981' : '#f59e0b'};font-size:18px">+${(b.edge * 100).toFixed(1)}%</div>
          <div style="font-size:11px;color:#9ca3af">Modelo ${(b.modelPct * 100).toFixed(0)}% vs Casa ${(b.housePct * 100).toFixed(0)}%</div>
        </td>
      </tr>`;

    return `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#0f172a;padding:24px 32px">
          <h2 style="color:#f8fafc;margin:0;font-size:18px">EdgeIQ — Value Bets Detectados</h2>
        </div>
        <div style="padding:24px 32px;background:#fff">
          ${
            alta.length > 0
              ? `
            <h3 style="color:#10b981;font-size:14px;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px">
              Confianza Alta (${alta.length})
            </h3>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
              ${alta.map(betRow).join('')}
            </table>
          `
              : ''
          }
          ${
            media.length > 0
              ? `
            <h3 style="color:#f59e0b;font-size:14px;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px">
              Confianza Media (${media.length})
            </h3>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              ${media.map(betRow).join('')}
            </table>
          `
              : ''
          }
          <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;text-align:center">
            Generado por EdgeIQ · Las apuestas siempre conllevan riesgo
          </p>
        </div>
      </div>
    `;
  }

  // ── WhatsApp (CallMeBot) ──

  private async sendWhatsApp(bets: ValueBetAlert[]): Promise<boolean> {
    if (!this.callmebotPhone || !this.callmebotKey) return false;

    const alta = bets.filter((b) => b.confidence === 'alta');
    const media = bets.filter((b) => b.confidence === 'media');

    let msg = `*EdgeIQ — ${alta.length} Value Bet${alta.length > 1 ? 's' : ''} de Alta Confianza*\n\n`;

    for (const b of alta) {
      msg += `🟢 *${b.recommendation}*\n`;
      msg += `   ${b.match} · ${b.league}\n`;
      msg += `   ${b.kickoff}\n`;
      msg += `   Edge: *+${(b.edge * 100).toFixed(1)}%* (Modelo ${(b.modelPct * 100).toFixed(0)}% vs Casa ${(b.housePct * 100).toFixed(0)}%)\n\n`;
    }

    if (media.length > 0) {
      msg += `_${media.length} apuesta${media.length > 1 ? 's' : ''} de confianza media también disponible${media.length > 1 ? 's' : ''}_\n`;
    }

    try {
      const phone = this.callmebotPhone.replace('+', '');
      const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(msg)}&apikey=${this.callmebotKey}`;

      const res = await fetch(url);
      if (!res.ok) {
        this.logger.warn(
          `CallMeBot respondió ${res.status}: ${await res.text()}`,
        );
        return false;
      }

      this.logger.log(
        `WhatsApp enviado a ${this.callmebotPhone} (${bets.length} bets)`,
      );
      return true;
    } catch (err) {
      this.logger.error('Error enviando WhatsApp', err);
      return false;
    }
  }
}
