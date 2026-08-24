import {
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

type CreateUserArgs = {
  data: { email: string; passwordHash: string; name: string | null };
};
type UpdateUserArgs = {
  where: { id: string };
  data: Record<string, unknown>;
};

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock<Promise<unknown>, [CreateUserArgs]>;
      update: jest.Mock<Promise<unknown>, [UpdateUserArgs]>;
    };
  };
  let jwt: { sign: jest.Mock };
  let notifications: { sendTransactionalEmail: jest.Mock };

  const baseUser = {
    id: 'user-1',
    email: 'test@edgeiq.dev',
    name: 'Test User',
    passwordHash: null as string | null,
    resetCode: null as string | null,
    resetCodeExp: null as Date | null,
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn<Promise<unknown>, [CreateUserArgs]>(),
        update: jest.fn<Promise<unknown>, [UpdateUserArgs]>(),
      },
    };
    jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    notifications = {
      sendTransactionalEmail: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('register', () => {
    it('rechaza el registro si el email ya existe', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser });

      await expect(
        service.register('test@edgeiq.dev', 'password123'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('crea el usuario con password hasheado y devuelve un token', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        ...baseUser,
        passwordHash: 'hashed',
      });

      const result = await service.register(
        'test@edgeiq.dev',
        'password123',
        'Test User',
      );

      const createCall = prisma.user.create.mock.calls[0][0];
      expect(createCall.data.email).toBe('test@edgeiq.dev');
      expect(createCall.data.name).toBe('Test User');
      expect(createCall.data.passwordHash).not.toBe('password123');
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.user).toEqual({
        id: 'user-1',
        email: 'test@edgeiq.dev',
        name: 'Test User',
      });
    });
  });

  describe('login', () => {
    it('rechaza credenciales si el usuario no existe', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login('nope@edgeiq.dev', 'password123'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza credenciales si el password no coincide', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 12);
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, passwordHash });

      await expect(
        service.login('test@edgeiq.dev', 'wrong-password'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('devuelve un token cuando las credenciales son correctas', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 12);
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, passwordHash });

      const result = await service.login('test@edgeiq.dev', 'correct-password');

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.user.email).toBe('test@edgeiq.dev');
    });
  });

  describe('resetPassword', () => {
    it('rechaza un código incorrecto', async () => {
      const resetCode = await bcrypt.hash('123456', 10);
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        resetCode,
        resetCodeExp: new Date(Date.now() + 60_000),
      });

      await expect(
        service.resetPassword('test@edgeiq.dev', '999999', 'new-password'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza un código expirado', async () => {
      const resetCode = await bcrypt.hash('123456', 10);
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        resetCode,
        resetCodeExp: new Date(Date.now() - 60_000),
      });

      await expect(
        service.resetPassword('test@edgeiq.dev', '123456', 'new-password'),
      ).rejects.toThrow(BadRequestException);
    });

    it('actualiza el password y limpia el código cuando es válido', async () => {
      const resetCode = await bcrypt.hash('123456', 10);
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        resetCode,
        resetCodeExp: new Date(Date.now() + 60_000),
      });
      prisma.user.update.mockResolvedValue({
        ...baseUser,
        passwordHash: 'new-hash',
      });

      const result = await service.resetPassword(
        'test@edgeiq.dev',
        '123456',
        'new-password',
      );

      const updateCall = prisma.user.update.mock.calls[0][0];
      expect(updateCall.data.resetCode).toBeNull();
      expect(updateCall.data.resetCodeExp).toBeNull();
      expect(result.accessToken).toBe('signed.jwt.token');
    });
  });
});
