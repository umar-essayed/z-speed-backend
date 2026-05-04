import { Test, TestingModule } from '@nestjs/testing';
import { DriversService } from './drivers.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../gateway/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ApplicationStatus, DeliveryRequestStatus, OrderStatus } from '@prisma/client';

describe('DriversService', () => {
  let service: DriversService;
  let prisma: PrismaService;
  let gateway: RealtimeGateway;
  let notifications: NotificationsService;

  const mockPrismaService = {
    driverProfile: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    vehicle: {
      upsert: jest.fn(),
    },
    deliveryRequest: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    order: {
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    ledger: {
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockGateway = {
    emitToCustomer: jest.fn(),
  };

  const mockNotifications = {
    notifyCustomer: jest.fn(),
  };

  beforeEach(async () => {
    const mockRedis = {
      geoadd: jest.fn(),
      zrem: jest.fn(),
      georadius: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DriversService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RealtimeGateway, useValue: mockGateway },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get<DriversService>(DriversService);
    prisma = module.get<PrismaService>(PrismaService);
    gateway = module.get<RealtimeGateway>(RealtimeGateway);
    notifications = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('applyDriver', () => {
    const userId = 'user-1';
    const applyDto = {
      nationalId: '12345678901234',
      nationalIdUrl: 'http://doc.id',
      driverLicenseUrl: 'http://license.id',
      payoutPhoneNumber: '01234567890',
      vehicle: {
        type: 'MOTORCYCLE',
        plateNumber: '123-abc',
      },
    };

    it('should throw NotFoundException if profile not found', async () => {
      mockPrismaService.driverProfile.findUnique.mockResolvedValue(null);

      await expect(service.applyDriver(userId, applyDto as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should update driver application and upsert vehicle', async () => {
      mockPrismaService.driverProfile.findUnique.mockResolvedValue({ id: 'driver-1' });
      mockPrismaService.driverProfile.update.mockResolvedValue({ id: 'driver-1', userId });

      const result = await service.applyDriver(userId, applyDto as any);

      expect(result).toBeDefined();
      expect(mockPrismaService.driverProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
          data: expect.objectContaining({ applicationStatus: ApplicationStatus.UNDER_REVIEW }),
        }),
      );
      expect(mockPrismaService.vehicle.upsert).toHaveBeenCalled();
    });
  });

  describe('acceptRequest', () => {
    const userId = 'user-1';
    const requestId = 'req-1';

    it('should throw NotFoundException if delivery request not found', async () => {
      mockPrismaService.driverProfile.findUnique.mockResolvedValue({ id: 'driver-1' });
      mockPrismaService.deliveryRequest.findUnique.mockResolvedValue(null);

      await expect(service.acceptRequest(userId, requestId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if request is not assigned to driver', async () => {
      mockPrismaService.driverProfile.findUnique.mockResolvedValue({ id: 'driver-1' });
      mockPrismaService.deliveryRequest.findUnique.mockResolvedValue({
        id: requestId,
        driverId: 'driver-2', // different driver
      });

      await expect(service.acceptRequest(userId, requestId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if request is not pending', async () => {
      mockPrismaService.driverProfile.findUnique.mockResolvedValue({ id: 'driver-1' });
      mockPrismaService.deliveryRequest.findUnique.mockResolvedValue({
        id: requestId,
        driverId: 'driver-1',
        status: DeliveryRequestStatus.ACCEPTED,
      });

      await expect(service.acceptRequest(userId, requestId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if request is expired', async () => {
      mockPrismaService.driverProfile.findUnique.mockResolvedValue({ id: 'driver-1' });
      mockPrismaService.deliveryRequest.findUnique.mockResolvedValue({
        id: requestId,
        driverId: 'driver-1',
        status: DeliveryRequestStatus.PENDING,
        expiresAt: new Date(Date.now() - 10000), // 10s ago
      });

      await expect(service.acceptRequest(userId, requestId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should accept request and assign driver successfully', async () => {
      mockPrismaService.driverProfile.findUnique.mockResolvedValue({ id: 'driver-1' });
      mockPrismaService.deliveryRequest.findUnique.mockResolvedValue({
        id: requestId,
        driverId: 'driver-1',
        status: DeliveryRequestStatus.PENDING,
        orderId: 'order-1',
        expiresAt: new Date(Date.now() + 100000), // valid
      });
      mockPrismaService.order.findUnique.mockResolvedValue({ id: 'order-1', customerId: 'customer-1' });

      const result = await service.acceptRequest(userId, requestId);

      expect(result.message).toBe('Delivery request accepted');
      expect(mockPrismaService.deliveryRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: { status: DeliveryRequestStatus.ACCEPTED },
      });
      expect(mockPrismaService.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: expect.objectContaining({ status: OrderStatus.IN_PROGRESS }),
      });
      expect(mockPrismaService.deliveryRequest.updateMany).toHaveBeenCalled();
      expect(mockNotifications.notifyCustomer).toHaveBeenCalled();
    });
  });

  describe('rejectRequest', () => {
    it('should reject request and update acceptance rate', async () => {
      const userId = 'user-1';
      const requestId = 'req-1';

      mockPrismaService.driverProfile.findUnique.mockResolvedValue({ id: 'driver-1' });
      mockPrismaService.deliveryRequest.findUnique.mockResolvedValue({
        id: requestId,
        driverId: 'driver-1',
      });
      mockPrismaService.driverProfile.update
        .mockResolvedValueOnce({ id: 'driver-1', totalAccepted: 8, totalRejected: 2 })
        .mockResolvedValueOnce({ id: 'driver-1', totalAccepted: 8, totalRejected: 2 });

      const result = await service.rejectRequest(userId, requestId);

      expect(result.message).toBe('Delivery request rejected');
      expect(mockPrismaService.deliveryRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: { status: DeliveryRequestStatus.REJECTED },
      });
      expect(mockPrismaService.driverProfile.update).toHaveBeenCalledTimes(2);
    });
  });
});
