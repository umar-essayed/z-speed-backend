import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDisputeDto, ResolveDisputeDto } from './dto';

@Injectable()
export class DisputesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(customerId: string, dto: CreateDisputeDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.customerId !== customerId) {
      throw new ForbiddenException('Not your order');
    }

    return this.prisma.orderDispute.create({
      data: {
        orderId: dto.orderId,
        customerId,
        reason: dto.reason,
        details: dto.details,
      },
    });
  }

  async findAll() {
    return this.prisma.orderDispute.findMany({
      include: {
        order: true,
        customer: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const dispute = await this.prisma.orderDispute.findUnique({
      where: { id },
      include: {
        order: true,
        customer: { select: { name: true, email: true } },
      },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');
    return dispute;
  }

  async resolve(id: string, adminId: string, dto: ResolveDisputeDto) {
    const dispute = await this.findOne(id);

    return this.prisma.orderDispute.update({
      where: { id },
      data: {
        status: dto.status,
        adminResolution: dto.resolution,
        resolvedById: adminId,
        updatedAt: new Date(),
      },
    });
  }
}
