import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ReqCtx } from '../../common/auth.types';
import { AllowPendingPassword, Ctx, Public } from '../../common/decorators';
import { ApiZBody, ZBody } from '../../common/zod';
import { PrismaService } from '../../common/prisma.service';
import { CSRF_COOKIE, SESSION_COOKIE } from './auth.guard';
import { AuthService } from './auth.service';

const LoginSchema = z.object({
  username: z.string().trim().min(1, 'Ingrese el usuario').max(80),
  password: z.string().min(1, 'Ingrese la contraseña').max(200),
});
const ChangePwdSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });

function cookieOpts(expires?: Date) {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== 'false',
    sameSite: 'strict' as const,
    path: '/',
    expires,
  };
}

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: Number(process.env.LOGIN_RATE_LIMIT ?? 10), ttl: 60_000 } })
  @ApiZBody(LoginSchema)
  async login(@ZBody(LoginSchema) body: z.infer<typeof LoginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(body.username, body.password, req.ip, req.headers['user-agent']?.slice(0, 300));
    res.cookie(SESSION_COOKIE, r.token, cookieOpts(r.expiresAt));
    res.cookie(CSRF_COOKIE, r.csrfToken, { ...cookieOpts(r.expiresAt), httpOnly: false });
    return { csrfToken: r.csrfToken, expiresAt: r.expiresAt };
  }

  @Post('logout')
  @HttpCode(200)
  @AllowPendingPassword()
  async logout(@Ctx() ctx: ReqCtx, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(ctx);
    res.clearCookie(SESSION_COOKIE, cookieOpts());
    res.clearCookie(CSRF_COOKIE, { ...cookieOpts(), httpOnly: false });
    return { ok: true };
  }

  @Get('me')
  @AllowPendingPassword()
  async me(@Ctx() ctx: ReqCtx) {
    const u = ctx.user;
    const areas = await this.prisma.area.findMany({ where: { id: { in: u.areaIds } }, select: { id: true, name: true } });
    return {
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      role: { code: u.roleCode, name: u.roleName, scope: u.scope },
      permissions: [...u.permissions].sort(),
      areas,
      isTechnicalStaff: u.isTechnicalStaff,
      mustChangePassword: u.mustChangePassword,
      csrfToken: u.csrfToken,
    };
  }

  @Post('change-password')
  @HttpCode(200)
  @AllowPendingPassword()
  @ApiZBody(ChangePwdSchema)
  async changePassword(@Ctx() ctx: ReqCtx, @ZBody(ChangePwdSchema) body: z.infer<typeof ChangePwdSchema>) {
    await this.auth.changePassword(ctx, body.currentPassword, body.newPassword);
    return { ok: true };
  }
}
