import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('Auth (e2e)', () => {
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

  it('should register a customer → login → get /users/me → logout', async () => {
    const randomEmail = `customer_${Date.now()}@example.com`;
    const randomPhone = `+9715${Math.floor(10000000 + Math.random() * 90000000)}`;

    // 1. Register
    const registerResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register-email')
      .send({
        name: 'Test Customer',
        email: randomEmail,
        password: 'password123',
        phone: randomPhone,
        role: 'CUSTOMER',
      })
      .expect(201);

    expect(registerResponse.body).toHaveProperty('accessToken');
    expect(registerResponse.body).toHaveProperty('refreshToken');

    const accessToken = registerResponse.body.accessToken;

    // 2. Get /users/me
    const meResponse = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(meResponse.body).toHaveProperty('id');
    expect(meResponse.body.email).toBe(randomEmail);

    // 3. Logout
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });
});
