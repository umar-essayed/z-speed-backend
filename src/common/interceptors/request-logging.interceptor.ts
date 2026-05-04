import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { method, url, body, query, params, ip, user } = request;
    const userAgent = request.get('user-agent') || '';
    const startTime = Date.now();

    // Mask sensitive fields in body if any (optional, but requested "everything")
    const sanitizedBody = { ...body };
    if (sanitizedBody.password) sanitizedBody.password = '********';

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode;

          this.logger.log(
            `[${method}] ${url} - ${statusCode} - ${duration}ms | IP: ${ip} | User: ${(user as any)?.userId || (user as any)?.id || 'Guest'} | Agent: ${userAgent}`,
          );
          
          if (Object.keys(sanitizedBody).length > 0) {
            this.logger.debug(`Body: ${JSON.stringify(sanitizedBody)}`);
          }
          if (Object.keys(query).length > 0) {
            this.logger.debug(`Query: ${JSON.stringify(query)}`);
          }
        },
        error: (err) => {
          const duration = Date.now() - startTime;
          this.logger.error(
            `[${method}] ${url} - FAILED - ${duration}ms | Error: ${err.message}`,
          );
        },
      }),
    );
  }
}
