import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * AuditInterceptor logs every mutating request (POST, PATCH, PUT, DELETE)
 * to the AuditLog table for traceability.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, user, ip } = request;

    // Only log mutating methods
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: (responseData) => {
          this.logAudit({
            userId: user?.userId,
            userRole: user?.role,
            action: `${method} ${url}`,
            targetTable: this.extractTableFromUrl(url),
            targetId: this.extractIdFromUrl(url),
            oldData: null,
            newData: body,
            ipAddress: ip || request.headers['x-forwarded-for'],
          });
        },
        error: (err) => {
          this.logger.warn(
            `Audit: ${method} ${url} failed in ${Date.now() - startTime}ms: ${err.message}`,
          );
        },
      }),
    );
  }

  private async logAudit(data: {
    userId?: string;
    userRole?: string;
    action: string;
    targetTable?: string;
    targetId?: string;
    oldData?: any;
    newData?: any;
    ipAddress?: string;
  }) {
    try {
      await this.prisma.auditLog.create({ data });
    } catch (err) {
      this.logger.error(`Failed to write audit log: ${err}`);
    }
  }

  private extractTableFromUrl(url: string): string {
    // Extract the resource name from URL: /api/v1/orders/xxx → orders
    const parts = url.replace('/api/v1/', '').split('/');
    return parts[0] || 'unknown';
  }

  private extractIdFromUrl(url: string): string | undefined {
    const parts = url.split('/');
    // UUID pattern
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return parts.find((p) => uuidPattern.test(p));
  }
}
