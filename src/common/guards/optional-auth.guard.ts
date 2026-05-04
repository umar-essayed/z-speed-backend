import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

/**
 * OptionalAuthGuard — Same as AuthGuard but does NOT throw on missing/invalid tokens.
 * Sets request.user = null if no valid token is found, allowing the request to proceed.
 *
 * Replaces the old OptionalSuperTokensAuthGuard.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<any>();

    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      request.user = null;
      return true;
    }

    const token = authHeader.split(' ')[1];

    try {
      const decoded = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET', 'dev-secret'),
      });

      request.user = {
        dbUserId: decoded.sub || decoded.dbUserId || decoded.userId,
        role: decoded.role,
        email: decoded.email,
      };
    } catch {
      // Try Supabase JWT secret as fallback
      try {
        const supabaseSecret = this.configService.get<string>('SUPABASE_JWT_SECRET');
        if (supabaseSecret) {
          const decoded = this.jwtService.verify(token, { secret: supabaseSecret });
          request.user = {
            supabaseId: decoded.sub,
            dbUserId: decoded.dbUserId || decoded.sub,
            role: decoded.role,
            email: decoded.email,
          };
        } else {
          request.user = null;
        }
      } catch {
        request.user = null;
      }
    }

    return true;
  }
}

/**
 * Backward-compatible alias
 */
export { OptionalAuthGuard as OptionalSuperTokensAuthGuard };
