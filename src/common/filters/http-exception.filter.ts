import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    const errorDetails = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      user: (request as any).user?.userId || 'Guest',
      body: request.body,
      query: request.query,
      message,
    };

    // LOG EVERYTHING
    this.logger.error(
      `CRITICAL ERROR: [${request.method}] ${request.url}`,
    );
    this.logger.error(`Status: ${status}`);
    this.logger.error(`Message: ${JSON.stringify(message)}`);
    this.logger.error(`User: ${errorDetails.user}`);
    this.logger.error(`Body: ${JSON.stringify(request.body)}`);
    this.logger.error(`Query: ${JSON.stringify(request.query)}`);
    
    if (exception instanceof Error) {
      this.logger.error(`Stack: ${exception.stack}`);
    } else {
      this.logger.error(`Exception: ${JSON.stringify(exception)}`);
    }

    if (response.headersSent) {
      return;
    }

    response.status(status).json({
      ...errorDetails,
      // Don't send stack trace to client in production, but we log it above
      stack: process.env.NODE_ENV === 'development' ? (exception as any).stack : undefined,
    });
  }
}
