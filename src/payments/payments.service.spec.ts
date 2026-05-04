import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { of, throwError } from 'rxjs';
import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let configService: ConfigService;
  let httpService: HttpService;
  let prisma: PrismaService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      if (key === 'CYBERSOURCE_MERCHANT_ID') return 'mock_merchant';
      if (key === 'CYBERSOURCE_API_KEY') return 'mock_api_key';
      if (key === 'CYBERSOURCE_API_SECRET') return Buffer.from('mock_secret').toString('base64');
      if (key === 'CYBERSOURCE_BASE_URL') return 'https://apitest.cybersource.com';
      if (key === 'CYBERSOURCE_SECRET_KEY') return 'mock_secret_key';
      if (key === 'ALLOWED_ORIGINS') return 'http://localhost:3000';
      return defaultValue;
    }),
  };

  const mockHttpService = {
    request: jest.fn(),
  };

  const mockPrismaService = {
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: HttpService, useValue: mockHttpService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    configService = module.get<ConfigService>(ConfigService);
    httpService = module.get<HttpService>(HttpService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getFlexCaptureContext', () => {
    it('should return capture context data on success', async () => {
      const mockResponse = { data: { captureContext: 'mock-jwt' } };
      mockHttpService.request.mockReturnValue(of(mockResponse));

      const result = await service.getFlexCaptureContext();

      expect(result).toEqual(mockResponse.data);
      expect(mockHttpService.request).toHaveBeenCalled();
    });

    it('should throw BadRequestException on failure', async () => {
      mockHttpService.request.mockReturnValue(throwError(() => new Error('API Error')));

      await expect(service.getFlexCaptureContext()).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('initiateFlexPayment', () => {
    const orderId = 'order-id';
    const transientToken = 'transient-token';

    it('should throw BadRequestException if order is not found', async () => {
      mockPrismaService.order.findUnique.mockResolvedValue(null);

      await expect(
        service.initiateFlexPayment(orderId, transientToken),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return success true and update order if AUTHORIZED', async () => {
      const mockOrder = {
        id: orderId,
        total: 100,
        customer: { name: 'John Doe', email: 'john@example.com', phone: '123' },
        deliveryAddress: 'Street 1',
      };
      mockPrismaService.order.findUnique.mockResolvedValue(mockOrder);

      const mockResponse = {
        data: { status: 'AUTHORIZED', id: 'txn-123' },
      };
      mockHttpService.request.mockReturnValue(of(mockResponse));

      const result = await service.initiateFlexPayment(orderId, transientToken);

      expect(result).toEqual({ success: true, transactionId: 'txn-123' });
      expect(mockPrismaService.order.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: { paymentState: 'PAID' },
      });
    });

    it('should return success false if not AUTHORIZED', async () => {
      const mockOrder = {
        id: orderId,
        total: 100,
        customer: { name: 'John Doe', email: 'john@example.com', phone: '123' },
        deliveryAddress: 'Street 1',
      };
      mockPrismaService.order.findUnique.mockResolvedValue(mockOrder);

      const mockResponse = {
        data: { status: 'DECLINED', id: 'txn-123' },
      };
      mockHttpService.request.mockReturnValue(of(mockResponse));

      const result = await service.initiateFlexPayment(orderId, transientToken);

      expect(result.success).toBe(false);
      expect(result.status).toBe('DECLINED');
      expect(mockPrismaService.order.update).not.toHaveBeenCalled();
    });

    it('should return success false on API request exception', async () => {
      const mockOrder = {
        id: orderId,
        total: 100,
        customer: { name: 'John Doe', email: 'john@example.com', phone: '123' },
        deliveryAddress: 'Street 1',
      };
      mockPrismaService.order.findUnique.mockResolvedValue(mockOrder);
      mockHttpService.request.mockReturnValue(throwError(() => new Error('Network error')));

      const result = await service.initiateFlexPayment(orderId, transientToken);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('verifyWebhookSignature', () => {
    it('should return true for a valid signature', () => {
      const payload = { event: 'payment_captured' };
      const secret = 'mock_secret_key';
      const signature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('base64');

      const isValid = service.verifyWebhookSignature(payload, signature);

      expect(isValid).toBe(true);
    });

    it('should return false for an invalid signature', () => {
      const payload = { event: 'payment_captured' };
      const secret = 'mock_secret_key';
      const validSignature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('base64');
      
      const invalidSignature = validSignature.slice(0, -1) + (validSignature.slice(-1) === 'A' ? 'B' : 'A');

      const isValid = service.verifyWebhookSignature(payload, invalidSignature);

      expect(isValid).toBe(false);
    });
  });

  describe('processReversal', () => {
    it('should process reversal successfully', async () => {
      const transactionId = 'txn-123';
      const amount = 50;
      const mockResponse = { data: { status: 'REVERSED' } };
      mockHttpService.request.mockReturnValue(of(mockResponse));

      const result = await service.processReversal(transactionId, amount);

      expect(result).toEqual(mockResponse.data);
      expect(mockHttpService.request).toHaveBeenCalled();
    });

    it('should throw BadRequestException on reversal error', async () => {
      const transactionId = 'txn-123';
      const amount = 50;
      mockHttpService.request.mockReturnValue(throwError(() => new Error('Refund failed')));

      await expect(service.processReversal(transactionId, amount)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
