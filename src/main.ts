import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  const allowedOrigins = configService.get<string>('ALLOWED_ORIGINS', '');

  // Security
  app.use(helmet());

  // CORS
  app.enableCors({
    origin: allowedOrigins ? allowedOrigins.split(',') : '*',
    allowedHeaders: [
      'content-type', 
      'authorization', 
      'idempotency-key', 
      'mfa-token', 
      'app-integrity'
    ],
    credentials: true,
  });

  // Global Prefix
  app.setGlobalPrefix('api/v1');

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global Exception Filters
  app.useGlobalFilters(
    new HttpExceptionFilter(),
  );

  // Global Interceptors
  app.useGlobalInterceptors(
    new RequestLoggingInterceptor(),
  );

  // Swagger Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Z-Speed API')
    .setDescription('The Z-Speed Food Delivery System API documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/v1/docs', app, document);

  await app.listen(port, '0.0.0.0');
  Logger.log(
    `🚀 Z-Speed API is running on: http://localhost:${port}/api/v1`,
    'Bootstrap',
  );
}
bootstrap();
