import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role, OrderStatus, ApplicationStatus } from '@prisma/client';
import { getQueueToken } from '@nestjs/bull';

describe('Complete Order Flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
      process: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getQueueToken('notifications'))
      .useValue(mockQueue)
      .overrideProvider(getQueueToken('emails'))
      .useValue(mockQueue)
      .compile();

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

    prisma = moduleFixture.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  jest.setTimeout(240000);

  it('should go through the complete order lifecycle', async () => {
    const timestamp = Date.now();
    const vendorEmail = `vendor_${timestamp}@example.com`;
    const driverEmail = `driver_${timestamp}@example.com`;
    const customerEmail = `customer_${timestamp}@example.com`;
    const phone = (role: string) => `+97150${Math.floor(1000000 + Math.random() * 9000000)}`;

    try {
      console.log('Step 1: REGISTER VENDOR');
      const vendorRegRes = await request(app.getHttpServer())
        .post('/api/v1/auth/register-email')
        .send({
          name: 'John Vendor',
          email: vendorEmail,
          password: 'password123',
          phone: phone('vendor'),
          role: Role.VENDOR,
        });

      if (vendorRegRes.status !== 201) {
        console.error('Vendor registration failed:', vendorRegRes.body);
      }
      expect(vendorRegRes.status).toBe(201);
      const vendorToken = vendorRegRes.body.accessToken;

      console.log('Step 2: CREATE RESTAURANT');
      const restaurantRes = await request(app.getHttpServer())
        .post('/api/v1/vendor/restaurants')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          name: 'The Good Burger',
          latitude: 25.2048,
          longitude: 55.2708,
          address: 'Downtown Dubai',
          city: 'Dubai',
        });

      if (restaurantRes.status !== 201) {
        console.error('Restaurant creation failed:', restaurantRes.body);
      }
      expect(restaurantRes.status).toBe(201);
      const restaurantId = restaurantRes.body.id;

      // Approve Restaurant & toggle open via Prisma
      await prisma.restaurant.update({
        where: { id: restaurantId },
        data: { status: 'ACTIVE', isOpen: true },
      });

      console.log('Step 3: CREATE MENU SECTION');
      const sectionRes = await request(app.getHttpServer())
        .post('/api/v1/vendor/menu-sections')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          restaurantId,
          name: 'Burgers',
        });

      if (sectionRes.status !== 201) {
        console.error('Menu section creation failed:', sectionRes.body);
      }
      expect(sectionRes.status).toBe(201);
      const sectionId = sectionRes.body.id;

      console.log('Step 4: CREATE FOOD ITEM');
      const foodItemRes = await request(app.getHttpServer())
        .post('/api/v1/vendor/food-items')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          sectionId,
          name: 'Classic Cheeseburger',
          price: 35.00,
        });

      if (foodItemRes.status !== 201) {
        console.error('Food item creation failed:', foodItemRes.body);
      }
      expect(foodItemRes.status).toBe(201);
      const foodItemId = foodItemRes.body.id;

      console.log('Step 5: REGISTER DRIVER');
      const driverRegRes = await request(app.getHttpServer())
        .post('/api/v1/auth/register-email')
        .send({
          name: 'Mike Driver',
          email: driverEmail,
          password: 'password123',
          phone: phone('driver'),
          role: Role.DRIVER,
        });

      if (driverRegRes.status !== 201) {
        console.error('Driver registration failed:', driverRegRes.body);
      }
      expect(driverRegRes.status).toBe(201);
      const driverToken = driverRegRes.body.accessToken;

      console.log('Step 6: APPLY DRIVER');
      const driverApplyRes = await request(app.getHttpServer())
        .post('/api/v1/drivers/apply')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          nationalId: '784199012345678',
          nationalIdUrl: 'https://example.com/id.jpg',
          driverLicenseUrl: 'https://example.com/license.jpg',
          vehicle: {
            type: 'MOTORCYCLE',
            make: 'Yamaha',
            model: 'R1',
            year: 2022,
            plateNumber: 'XYZ-123',
          },
        });

      if (driverApplyRes.status !== 201) {
        console.error('Driver application failed:', driverApplyRes.body);
      }
      expect(driverApplyRes.status).toBe(201);

      // Approve Driver via Prisma
      await prisma.driverProfile.update({
        where: { id: driverApplyRes.body.id },
        data: {
          applicationStatus: ApplicationStatus.APPROVED,
          isAvailable: true,
          currentLat: 25.2048,
          currentLng: 55.2708,
          lastPingAt: new Date(),
        },
      });

      console.log('Step 7: REGISTER CUSTOMER');
      const customerRegRes = await request(app.getHttpServer())
        .post('/api/v1/auth/register-email')
        .send({
          name: 'Jane Customer',
          email: customerEmail,
          password: 'password123',
          phone: phone('customer'),
          role: Role.CUSTOMER,
        });

      if (customerRegRes.status !== 201) {
        console.error('Customer registration failed:', customerRegRes.body);
      }
      expect(customerRegRes.status).toBe(201);
      const customerToken = customerRegRes.body.accessToken;

      console.log('Step 8: ADD ADDRESS');
      const addressRes = await request(app.getHttpServer())
        .post('/api/v1/users/addresses')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          street: 'Burj Khalifa Blvd',
          city: 'Dubai',
          latitude: 25.1972,
          longitude: 55.2744,
        });

      if (addressRes.status !== 201) {
        console.error('Address creation failed:', addressRes.body);
      }
      expect(addressRes.status).toBe(201);
      const addressId = addressRes.body.id;

      console.log('Step 9: ADD FOOD ITEM TO CART');
      const cartRes = await request(app.getHttpServer())
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          foodItemId,
          quantity: 2,
        });

      if (cartRes.status !== 201) {
        console.error('Adding cart item failed:', cartRes.body);
      }
      expect(cartRes.status).toBe(201);

      console.log('Step 10: CHECKOUT');
      const checkoutRes = await request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          restaurantId,
          deliveryAddressId: addressId,
          paymentMethod: 'CASH',
        });

      if (checkoutRes.status !== 201) {
        console.error('Checkout failed:', checkoutRes.body);
      }
      expect(checkoutRes.status).toBe(201);
      const orderId = checkoutRes.body.id;

      console.log('Step 11: VENDOR CONFIRMS ORDER');
      const confirmRes = await request(app.getHttpServer())
        .patch(`/api/v1/vendor/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ status: OrderStatus.CONFIRMED });

      if (confirmRes.status !== 200) {
        console.error('Vendor confirm failed:', confirmRes.body);
      }
      expect(confirmRes.status).toBe(200);

      console.log('Step 12: VENDOR PREPARES ORDER');
      const prepareRes = await request(app.getHttpServer())
        .patch(`/api/v1/vendor/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ status: OrderStatus.PREPARING });

      if (prepareRes.status !== 200) {
        console.error('Vendor prepare failed:', prepareRes.body);
      }
      expect(prepareRes.status).toBe(200);

      console.log('Step 13: VENDOR READIES ORDER');
      const readyRes = await request(app.getHttpServer())
        .patch(`/api/v1/vendor/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ status: OrderStatus.READY });

      if (readyRes.status !== 200) {
        console.error('Vendor ready failed:', readyRes.body);
      }
      expect(readyRes.status).toBe(200);

      // Wait slightly for background async assignment
      await new Promise((resolve) => setTimeout(resolve, 1000));

      console.log('Step 14: DRIVER GETS DELIVERY REQUESTS');
      const requestsRes = await request(app.getHttpServer())
        .get('/api/v1/drivers/delivery-requests')
        .set('Authorization', `Bearer ${driverToken}`);

      if (requestsRes.status !== 200) {
        console.error('Get delivery requests failed:', requestsRes.body);
      }
      expect(requestsRes.status).toBe(200);
      expect(requestsRes.body.length).toBeGreaterThan(0);
      const requestId = requestsRes.body[0].id;

      console.log('Step 15: DRIVER ACCEPTS REQUEST');
      const acceptRes = await request(app.getHttpServer())
        .patch(`/api/v1/drivers/delivery-requests/${requestId}/accept`)
        .set('Authorization', `Bearer ${driverToken}`);

      if (acceptRes.status !== 200) {
        console.error('Accept request failed:', acceptRes.body);
      }
      expect(acceptRes.status).toBe(200);

      console.log('Step 16: DRIVER OUT FOR DELIVERY');
      const outRes = await request(app.getHttpServer())
        .patch(`/api/v1/vendor/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: OrderStatus.OUT_FOR_DELIVERY });

      if (outRes.status !== 200) {
        console.error('Driver out for delivery failed:', outRes.body);
      }
      expect(outRes.status).toBe(200);

      console.log('Step 17: DRIVER DELIVERS ORDER');
      const deliverRes = await request(app.getHttpServer())
        .patch(`/api/v1/vendor/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: OrderStatus.DELIVERED });

      if (deliverRes.status !== 200) {
        console.error('Driver deliver failed:', deliverRes.body);
      }
      expect(deliverRes.status).toBe(200);

      console.log('Step 18: CUSTOMER REVIEWS');
      const reviewRes = await request(app.getHttpServer())
        .post('/api/v1/reviews')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          orderId,
          restaurantRating: 5,
          driverRating: 5,
          comment: 'Great service and delicious food!',
        });

      if (reviewRes.status !== 201) {
        console.error('Review failed:', reviewRes.body);
      }
      expect(reviewRes.status).toBe(201);
    } catch (e) {
      console.error('E2E Test Execution Error', e);
      throw e;
    }
  });
});
