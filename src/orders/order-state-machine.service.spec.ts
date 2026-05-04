import { Test, TestingModule } from '@nestjs/testing';
import { OrderStateMachineService } from './order-state-machine.service';
import { OrderStatus, Role } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

describe('OrderStateMachineService', () => {
  let service: OrderStateMachineService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OrderStateMachineService],
    }).compile();

    service = module.get<OrderStateMachineService>(OrderStateMachineService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('canTransition', () => {
    it('should allow PENDING → CONFIRMED for VENDOR', () => {
      expect(
        service.canTransition(OrderStatus.PENDING, OrderStatus.CONFIRMED, Role.VENDOR),
      ).toBe(true);
    });

    it('should not allow DELIVERED → PREPARING', () => {
      expect(
        service.canTransition(OrderStatus.DELIVERED, OrderStatus.PREPARING, Role.VENDOR),
      ).toBe(false);
    });

    it('should allow CUSTOMER to cancel PENDING', () => {
      expect(
        service.canTransition(OrderStatus.PENDING, OrderStatus.CANCELLED, Role.CUSTOMER),
      ).toBe(true);
    });

    it('should not allow DRIVER to confirm order', () => {
      expect(
        service.canTransition(OrderStatus.PENDING, OrderStatus.CONFIRMED, Role.DRIVER),
      ).toBe(false);
    });
  });

  describe('validateTransition', () => {
    it('should throw BadRequestException for invalid transition', () => {
      expect(() =>
        service.validateTransition(
          OrderStatus.PENDING,
          OrderStatus.DELIVERED,
          Role.CUSTOMER,
        ),
      ).toThrow(BadRequestException);
    });

    it('should not throw for valid transition', () => {
      expect(() =>
        service.validateTransition(
          OrderStatus.PENDING,
          OrderStatus.CONFIRMED,
          Role.VENDOR,
        ),
      ).not.toThrow();
    });
  });
});
