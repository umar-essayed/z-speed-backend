import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('Vendor (e2e)', () => {
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

  it('should register vendor → create restaurant → add menu section → add food item', async () => {
    const randomEmail = `vendor_${Date.now()}@example.com`;
    const randomPhone = `+9715${Math.floor(10000000 + Math.random() * 90000000)}`;

    // 1. Register Vendor
    const registerResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register-email')
      .send({
        name: 'Test Vendor',
        email: randomEmail,
        password: 'password123',
        phone: randomPhone,
        role: 'VENDOR',
      })
      .expect(201);

    expect(registerResponse.body).toHaveProperty('accessToken');
    const accessToken = registerResponse.body.accessToken;

    // 2. Create Restaurant
    const createRestaurantResponse = await request(app.getHttpServer())
      .post('/api/v1/vendor/restaurants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Test Restaurant',
        latitude: 25.12345,
        longitude: 55.6789,
        address: 'Test Address 123',
        city: 'Dubai',
      })
      .expect(201);

    expect(createRestaurantResponse.body).toHaveProperty('id');
    expect(createRestaurantResponse.body.status).toBe('PENDING_VERIFICATION');
    const restaurantId = createRestaurantResponse.body.id;

    // 3. Add Menu Section
    const createSectionResponse = await request(app.getHttpServer())
      .post('/api/v1/vendor/menu-sections')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        restaurantId,
        name: 'Main Dishes',
      })
      .expect(201);

    expect(createSectionResponse.body).toHaveProperty('id');
    const sectionId = createSectionResponse.body.id;

    // 4. Add Food Item
    const createFoodResponse = await request(app.getHttpServer())
      .post('/api/v1/vendor/food-items')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        sectionId,
        name: 'Special Burger',
        price: 25.0,
      })
      .expect(201);

    expect(createFoodResponse.body).toHaveProperty('id');
    expect(createFoodResponse.body.name).toBe('Special Burger');
  });
});
