import { Test, TestingModule } from '@nestjs/testing';
import { RestaurantsService } from './restaurants.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';

describe('RestaurantsService', () => {
  let service: RestaurantsService;
  let prisma: PrismaService;

  const mockPrismaService = {
    restaurant: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    order: {
      count: jest.fn(),
      aggregate: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestaurantsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<RestaurantsService>(RestaurantsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create restaurant with PENDING_VERIFICATION status', async () => {
      const ownerId = 'vendor-1';
      const dto = {
        name: 'Burger Joint',
        latitude: 30.1,
        longitude: 31.2,
        address: '123 Street',
      };
      
      mockPrismaService.restaurant.create.mockResolvedValue({
        id: 'rest-1',
        ownerId,
        ...dto,
        status: AccountStatus.PENDING_VERIFICATION,
      });

      const result = await service.create(ownerId, dto as any);

      expect(result.status).toBe(AccountStatus.PENDING_VERIFICATION);
      expect(mockPrismaService.restaurant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AccountStatus.PENDING_VERIFICATION,
          }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('should throw NotFoundException if restaurant not found', async () => {
      mockPrismaService.restaurant.findUnique.mockResolvedValue(null);

      await expect(service.findById('rest-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return restaurant details on success', async () => {
      const mockRest = { id: 'rest-1', name: 'Burger Joint' };
      mockPrismaService.restaurant.findUnique.mockResolvedValue(mockRest);

      const result = await service.findById('rest-1');

      expect(result).toEqual(mockRest);
    });
  });

  describe('update', () => {
    const restId = 'rest-1';
    const ownerId = 'vendor-1';

    it('should throw NotFoundException if restaurant does not exist', async () => {
      mockPrismaService.restaurant.findUnique.mockResolvedValue(null);

      await expect(service.update(restId, ownerId, {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if user is not the owner', async () => {
      mockPrismaService.restaurant.findUnique.mockResolvedValue({
        id: restId,
        ownerId: 'vendor-2', // different owner
      });

      await expect(service.update(restId, ownerId, {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should update successfully when ownership is verified', async () => {
      mockPrismaService.restaurant.findUnique.mockResolvedValue({
        id: restId,
        ownerId: ownerId,
      });
      mockPrismaService.restaurant.update.mockResolvedValue({ id: restId, name: 'Updated' });

      const result = await service.update(restId, ownerId, { name: 'Updated' });

      expect(result.name).toBe('Updated');
      expect(mockPrismaService.restaurant.update).toHaveBeenCalled();
    });
  });

  describe('approve', () => {
    it('should set restaurant status to ACTIVE', async () => {
      mockPrismaService.restaurant.findUnique.mockResolvedValue({ id: 'rest-1' });
      mockPrismaService.restaurant.update.mockResolvedValue({
        id: 'rest-1',
        status: AccountStatus.ACTIVE,
      });

      const result = await service.approve('rest-1');

      expect(result.status).toBe(AccountStatus.ACTIVE);
      expect(mockPrismaService.restaurant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rest-1' },
          data: { status: AccountStatus.ACTIVE, isActive: true },
        }),
      );
    });
  });
});
