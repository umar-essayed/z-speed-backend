import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '@prisma/client';

/**
 * AuthGuard — Verifies JWT Bearer tokens from the Authorization header.
 *
 * Replaces the old SuperTokensAuthGuard.
 * Supports both our own JWT tokens and Supabase JWTs.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<any>();

    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('لم يتم توفير رمز المصادقة');
    }

    const token = authHeader.split(' ')[1];

    try {
      // Try verifying with our own JWT secret first
      const decoded = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET', 'dev-secret'),
      });

      // Inject user info into request for @CurrentUser decorator
      const userId = decoded.sub || decoded.dbUserId || decoded.userId;
      request.user = {
        dbUserId: userId,
        userId: userId, // Added alias for compatibility
        role: decoded.role,
        email: decoded.email,
      };
    } catch {
      // Fallback: try verifying with Supabase JWT secret
      try {
        const supabaseSecret = this.configService.get<string>('SUPABASE_JWT_SECRET');
        if (!supabaseSecret) {
          throw new UnauthorizedException('جلسة غير صالحة أو منتهية الصلاحية');
        }

        const decoded = this.jwtService.verify(token, { secret: supabaseSecret });
        const userId = decoded.dbUserId || decoded.sub;

        request.user = {
          supabaseId: decoded.sub,
          dbUserId: userId,
          userId: userId, // Added alias for compatibility
          role: decoded.role,
          email: decoded.email,
        };
      } catch {
        throw new UnauthorizedException('جلسة غير صالحة أو منتهية الصلاحية');
      }
    }

    // Role-based access control
    return this._handleRoleCheck(context, request);
  }

  private _handleRoleCheck(context: ExecutionContext, request: any): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const userRole: Role = request.user?.role;

    if (!requiredRoles.includes(userRole)) {
      throw new ForbiddenException(
        `Access restricted to: ${requiredRoles.join(', ')}`,
      );
    }
    return true;
  }
}

/**
 * Backward-compatible alias — controllers importing SuperTokensAuthGuard
 * will continue to work without changes during the transition period.
 */
export { AuthGuard as SuperTokensAuthGuard };
