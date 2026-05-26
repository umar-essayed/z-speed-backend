import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  const allowedOrigins = configService.get<string>('ALLOWED_ORIGINS', '');

  // Increase payload size limit for high-resolution base64 prescription uploads
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

  // Security
  app.use(helmet());

  // CORS
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin || !allowedOrigins || allowedOrigins === '*') {
        callback(null, true);
        return;
      }
      const origins = allowedOrigins.split(',').map((o) => o.trim().replace(/\/$/, ''));
      const isLocal = origin.startsWith('http://localhost') || 
                      origin.startsWith('http://127.0.0.1') || 
                      origin.startsWith('http://192.168.');
      
      const originHost = origin.replace(/^https?:\/\//, '').replace(/\/$/, '').split(':')[0];
      const isZspeedDomain = originHost === 'zspeedapp.com' || originHost.endsWith('.zspeedapp.com') ||
                             originHost === 'zspeed.com' || originHost.endsWith('.zspeed.com') ||
                             originHost === 'nexus-os.site' || originHost.endsWith('.nexus-os.site');

      if (isLocal || isZspeedDomain || origins.includes(origin.replace(/\/$/, ''))) {
        callback(null, true);
      } else {
        Logger.warn(`CORS blocked for origin: ${origin}`, 'Bootstrap');
        callback(null, false);
      }
    },
    allowedHeaders: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
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
