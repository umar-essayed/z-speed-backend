import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('Driver (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
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
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should register driver → apply as driver', async () => {
    const randomEmail = `driver_${Date.now()}@example.com`;
    const randomPhone = `+9715${Math.floor(10000000 + Math.random() * 90000000)}`;

    // 1. Register Driver
    const registerResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register-email')
      .send({
        name: 'Test Driver',
        email: randomEmail,
        password: 'password123',
        phone: randomPhone,
        role: 'DRIVER',
      })
      .expect(201);

    expect(registerResponse.body).toHaveProperty('accessToken');
    const accessToken = registerResponse.body.accessToken;

    // 2. Apply Driver
    const applyResponse = await request(app.getHttpServer())
      .post('/api/v1/drivers/apply')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        nationalId: '12345678901234',
        nationalIdUrl: 'http://example.com/national-id.png',
        driverLicenseUrl: 'http://example.com/license.png',
        vehicle: {
          type: 'Motorcycle',
          make: 'Honda',
          model: 'CBR',
          year: 2023,
          plateNumber: 'A123BC',
        },
      })
      .expect(201);

    expect(applyResponse.body).toHaveProperty('id');
    expect(applyResponse.body.applicationStatus).toBe('UNDER_REVIEW');
  });
});
