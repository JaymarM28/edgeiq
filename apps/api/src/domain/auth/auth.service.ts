import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface JwtPayload {
  sub: string; // userId
  email: string;
}

export interface AuthTokens {
  accessToken: string;
  user: { id: string; email: string; name: string | null };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly notifications: NotificationsService,
  ) {}

  async register(
    email: string,
    password: string,
    name?: string,
  ): Promise<AuthTokens> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('El email ya está registrado');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: { email, passwordHash, name: name ?? null },
    });

    this.logger.log(`Usuario registrado: ${email}`);
    return this.buildTokens(user);
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Credenciales inválidas');

    this.logger.log(`Login: ${email}`);
    return this.buildTokens(user);
  }

  async validatePayload(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true },
    });
    if (!user) throw new UnauthorizedException('Usuario no encontrado');
    return user;
  }

  // ── Password Reset ──

  async forgotPassword(email: string): Promise<{ sent: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new BadRequestException('No existe una cuenta con ese email');
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const exp = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetCode: codeHash, resetCodeExp: exp },
    });

    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#0f172a;padding:20px 28px">
          <h2 style="color:#f8fafc;margin:0;font-size:18px">EdgeIQ — Recuperar contraseña</h2>
        </div>
        <div style="padding:24px 28px;background:#fff">
          <p style="color:#374151;font-size:14px">Tu código de verificación es:</p>
          <div style="text-align:center;margin:20px 0">
            <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#10b981">${code}</span>
          </div>
          <p style="color:#6b7280;font-size:13px">Este código expira en 15 minutos. Si no solicitaste un cambio de contraseña, ignora este email.</p>
        </div>
      </div>
    `;

    const sent = await this.notifications.sendTransactionalEmail(
      email,
      'EdgeIQ — Código de recuperación',
      html,
    );

    if (!sent) this.logger.warn(`No se pudo enviar código de reset a ${email}`);
    return { sent };
  }

  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.resetCode || !user.resetCodeExp) {
      throw new BadRequestException('Código inválido o expirado');
    }

    if (new Date() > user.resetCodeExp) {
      throw new BadRequestException('El código ha expirado');
    }

    const valid = await bcrypt.compare(code, user.resetCode);
    if (!valid) {
      throw new BadRequestException('Código incorrecto');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetCode: null, resetCodeExp: null },
    });

    this.logger.log(`Password reseteado: ${email}`);
    return this.buildTokens(updated);
  }

  private buildTokens(user: {
    id: string;
    email: string;
    name: string | null;
  }): AuthTokens {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    return {
      accessToken: this.jwt.sign(payload),
      user: { id: user.id, email: user.email, name: user.name },
    };
  }
}
