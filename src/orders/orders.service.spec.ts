import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStateMachineService } from './order-state-machine.service';
import { RealtimeGateway } from '../gateway/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { PromotionsService } from '../promotions/promotions.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { DisputesService } from '../disputes/disputes.service';
import { PaymentsService } from '../payments/payments.service';
import { DriversService } from '../drivers/drivers.service';
import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { OrderStatus, PaymentState, AccountStatus, Role } from '@prisma/client';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: PrismaService;
  let stateMachine: OrderStateMachineService;
  let gateway: RealtimeGateway;
  let notifications: NotificationsService;
  let promotionsService: PromotionsService;
  let loyaltyService: LoyaltyService;
  let disputesService: DisputesService;
  let paymentsService: PaymentsService;
  let driversService: DriversService;

  const mockPrismaService = {
    cart: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    cartItem: {
      deleteMany: jest.fn(),
    },
    restaurant: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    address: {
      findFirst: jest.fn(),
    },
    systemConfig: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    order: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    ledger: {
      create: jest.fn(),
    },
    deliveryRequest: {
      create: jest.fn(),
    },
    driverProfile: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockStateMachine = {
    validateTransition: jest.fn(),
  };

  const mockGateway = {
    emitToVendor: jest.fn(),
    emitToCustomer: jest.fn(),
    emitToOrder: jest.fn(),
    emitToDriver: jest.fn(),
  };

  const mockNotifications = {
    notifyVendor: jest.fn(),
    notifyCustomer: jest.fn(),
    notifyAvailableDrivers: jest.fn(),
  };

  const mockPromotionsService = {
    validate: jest.fn(),
    incrementUsage: jest.fn(),
  };

  const mockLoyaltyService = {
    addPoints: jest.fn(),
  };

  const mockDisputesService = {
    create: jest.fn(),
  };

  const mockPaymentsService = {
    initiateFlexPayment: jest.fn(),
    getFlexCaptureContext: jest.fn(),
    verifyWebhookSignature: jest.fn(),
  };

  const mockDriversService = {
    findNearbyDrivers: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: OrderStateMachineService, useValue: mockStateMachine },
        { provide: RealtimeGateway, useValue: mockGateway },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: PromotionsService, useValue: mockPromotionsService },
        { provide: LoyaltyService, useValue: mockLoyaltyService },
        { provide: DisputesService, useValue: mockDisputesService },
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: DriversService, useValue: mockDriversService },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    prisma = module.get<PrismaService>(PrismaService);
    stateMachine = module.get<OrderStateMachineService>(OrderStateMachineService);
    gateway = module.get<RealtimeGateway>(RealtimeGateway);
    notifications = module.get<NotificationsService>(NotificationsService);
    promotionsService = module.get<PromotionsService>(PromotionsService);
    loyaltyService = module.get<LoyaltyService>(LoyaltyService);
    disputesService = module.get<DisputesService>(DisputesService);
    paymentsService = module.get<PaymentsService>(PaymentsService);
    driversService = module.get<DriversService>(DriversService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkout', () => {
    const customerId = 'customer-id';
    const checkoutDto = {
      restaurantId: 'rest-id',
      deliveryAddressId: 'addr-id',
      paymentMethod: 'CASH',
      customerNote: 'Leave at door',
    };

    it('should throw BadRequestException if cart is empty', async () => {
      mockPrismaService.cart.findUnique.mockResolvedValue(null);

      await expect(service.checkout(customerId, checkoutDto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if restaurant is not active', async () => {
      mockPrismaService.cart.findUnique.mockResolvedValue({
        items: [{ unitPrice: 10, quantity: 2 }],
      });
      mockPrismaService.restaurant.findUnique.mockResolvedValue({
        id: 'rest-id',
        status: AccountStatus.PENDING_VERIFICATION,
        isOpen: true,
      });

      await expect(service.checkout(customerId, checkoutDto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if restaurant is closed', async () => {
      mockPrismaService.cart.findUnique.mockResolvedValue({
        items: [{ unitPrice: 10, quantity: 2 }],
      });
      mockPrismaService.restaurant.findUnique.mockResolvedValue({
        id: 'rest-id',
        status: AccountStatus.ACTIVE,
        isOpen: false,
      });

      await expect(service.checkout(customerId, checkoutDto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if address is not found', async () => {
      mockPrismaService.cart.findUnique.mockResolvedValue({
        items: [{ unitPrice: 10, quantity: 2 }],
      });
      mockPrismaService.restaurant.findUnique.mockResolvedValue({
        id: 'rest-id',
        status: AccountStatus.ACTIVE,
        isOpen: true,
      });
      mockPrismaService.address.findFirst.mockResolvedValue(null);

      await expect(service.checkout(customerId, checkoutDto as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should create order with CASH payment successfully', async () => {
      mockPrismaService.cart.findUnique.mockResolvedValue({
        id: 'cart-id',
        items: [{ foodItemId: 'food-1', unitPrice: 10, quantity: 2 }],
      });
      mockPrismaService.restaurant.findUnique.mockResolvedValue({
        id: 'rest-id',
        status: AccountStatus.ACTIVE,
        isOpen: true,
        deliveryFee: 15,
      });
      mockPrismaService.address.findFirst.mockResolvedValue({
        street: 'Main St',
        city: 'Cairo',
        latitude: 30.0,
        longitude: 31.0,
      });
      mockPrismaService.systemConfig.findUnique.mockResolvedValue({ platformFeePercent: 2.0 });

      const mockCreatedOrder = { id: 'order-1', total: 35.4 };
      mockPrismaService.order.create.mockResolvedValue(mockCreatedOrder);

      const result = await service.checkout(customerId, checkoutDto as any);

      expect(result).toEqual(mockCreatedOrder);
      expect(mockPrismaService.order.create).toHaveBeenCalled();
      expect(mockPrismaService.cartItem.deleteMany).toHaveBeenCalled();
      expect(mockNotifications.notifyVendor).toHaveBeenCalled();
    });

    it('should throw BadRequestException if insufficient wallet balance', async () => {
      const walletCheckoutDto = { ...checkoutDto, paymentMethod: 'WALLET' };
      mockPrismaService.cart.findUnique.mockResolvedValue({
        items: [{ unitPrice: 100, quantity: 2 }],
      });
      mockPrismaService.restaurant.findUnique.mockResolvedValue({
        id: 'rest-id',
        status: AccountStatus.ACTIVE,
        isOpen: true,
        deliveryFee: 15,
      });
      mockPrismaService.address.findFirst.mockResolvedValue({
        street: 'Main St', city: 'Cairo', latitude: 30.0, longitude: 31.0,
      });
      mockPrismaService.systemConfig.findUnique.mockResolvedValue({ platformFeePercent: 2.0 });
      mockPrismaService.user.findUnique.mockResolvedValue({ walletBalance: 50 }); // Less than ~219

      await expect(service.checkout(customerId, walletCheckoutDto as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('updateStatus', () => {
    it('should update status and trigger side effects on DELIVERED', async () => {
      const orderId = 'order-1';
      const orderData = {
        id: orderId,
        customerId: 'cust-1',
        restaurantId: 'rest-1',
        status: OrderStatus.OUT_FOR_DELIVERY,
        subtotal: 100,
        deliveryFee: 15,
        serviceFee: 2,
        total: 117,
        driverId: 'driver-1',
      };
      
      mockPrismaService.order.findUnique.mockResolvedValue(orderData);
      mockPrismaService.order.update.mockResolvedValue({
        ...orderData,
        status: OrderStatus.DELIVERED,
      });
      mockPrismaService.restaurant.findUnique.mockResolvedValue({
        id: 'rest-1',
        ownerId: 'owner-1',
      });
      mockPrismaService.driverProfile.findUnique.mockResolvedValue({
        id: 'driver-1',
        userId: 'driver-user-1',
      });
      mockPrismaService.systemConfig.findUnique.mockResolvedValue({ loyaltyPointsPerEGP: 1.0 });

      const result = await service.updateStatus(
        orderId,
        { status: OrderStatus.DELIVERED },
        'owner-1',
        Role.VENDOR,
      );

      expect(result.status).toBe(OrderStatus.DELIVERED);
      expect(mockStateMachine.validateTransition).toHaveBeenCalled();
      expect(mockPrismaService.restaurant.update).toHaveBeenCalled();
      expect(mockPrismaService.user.update).toHaveBeenCalled(); // Update driver's wallet
      expect(mockLoyaltyService.addPoints).toHaveBeenCalledWith('cust-1', 117);
    });
  });

  describe('cancelOrder', () => {
    it('should successfully cancel order and refund wallet if PAID', async () => {
      const orderId = 'order-1';
      const orderData = {
        id: orderId,
        customerId: 'cust-1',
        status: OrderStatus.PENDING,
        paymentState: PaymentState.PAID,
        total: 100,
      };

      mockPrismaService.order.findUnique.mockResolvedValue(orderData);
      mockPrismaService.order.update.mockResolvedValue({
        ...orderData,
        status: OrderStatus.CANCELLED,
      });

      const result = await service.cancelOrder(orderId, 'cust-1');

      expect(result.status).toBe(OrderStatus.CANCELLED);
      expect(mockPrismaService.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cust-1' },
          data: { walletBalance: { increment: 100 } },
        }),
      );
      expect(mockPrismaService.ledger.create).toHaveBeenCalled();
    });
  });
});
