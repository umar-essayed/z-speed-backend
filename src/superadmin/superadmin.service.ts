import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ApprovalStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SuperadminService {
  private readonly logger = new Logger(SuperadminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // =============================================
  // PENDING APPROVALS
  // =============================================

  async listPendingApprovals(filters: {
    status?: ApprovalStatus;
    actionType?: string;
    page?: number;
    limit?: number;
  }) {
    const { status, actionType, page = 1, limit = 20 } = filters;
    const where: any = {};
    if (status) where.status = status;
    if (actionType) where.actionType = actionType;

    const [data, total] = await Promise.all([
      this.prisma.pendingApproval.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          requestedBy: { select: { name: true, email: true, role: true } },
          reviewedBy: { select: { name: true, email: true } },
        },
      }),
      this.prisma.pendingApproval.count({ where }),
    ]);

    return { data, total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / limit) };
  }

  async getApprovalDetails(id: string) {
    const approval = await this.prisma.pendingApproval.findUnique({
      where: { id },
      include: {
        requestedBy: { select: { name: true, email: true, role: true } },
        reviewedBy: { select: { name: true, email: true } },
      },
    });
    if (!approval) throw new NotFoundException('Approval not found');
    return approval;
  }

  /**
   * Execute (approve) a pending approval action.
   */
  async executeApproval(approvalId: string, superadminId: string) {
    const approval = await this.prisma.pendingApproval.findUnique({
      where: { id: approvalId },
    });
    if (!approval) throw new NotFoundException('Approval not found');
    if (approval.status !== ApprovalStatus.PENDING) {
      throw new BadRequestException('Approval already processed');
    }

    // Execute the action based on type
    switch (approval.actionType) {
      case 'hard_delete_user':
        await this.prisma.user.delete({ where: { id: approval.targetId } });
        break;

      case 'ban_user':
        await this.prisma.user.update({
          where: { id: approval.targetId },
          data: { status: 'BANNED' },
        });
        break;

      case 'payout_request':
        // Already deducted — mark ledger as completed
        const payoutPayload = approval.payload as any;
        if (payoutPayload?.idempotencyKey) {
          await this.prisma.ledger.update({
            where: { referenceId: payoutPayload.idempotencyKey },
            data: { status: 'completed' },
          });
        }
        break;

      case 'hard_reject_restaurant':
        await this.prisma.restaurant.delete({ where: { id: approval.targetId } });
        break;

      default:
        this.logger.warn(`Unknown approval type: ${approval.actionType}`);
    }

    // Update approval record
    await this.prisma.pendingApproval.update({
      where: { id: approvalId },
      data: {
        status: ApprovalStatus.APPROVED,
        reviewedById: superadminId,
        reviewedAt: new Date(),
      },
    });

    // Create audit log
    await this.prisma.auditLog.create({
      data: {
        userId: superadminId,
        userRole: 'SUPERADMIN',
        action: `approval_executed:${approval.actionType}`,
        targetTable: approval.targetTable,
        targetId: approval.targetId,
        newData: { approvalId, action: 'approved' },
      },
    });

    // Notify the requesting admin
    await this.notifications.createNotification(
      approval.requestedById,
      'Approval Processed',
      `Your ${approval.actionType} request has been approved.`,
      'approval_result',
    );

    this.logger.log(`Approval ${approvalId} executed by ${superadminId}`);
    return { message: 'Approval executed successfully' };
  }

  /**
   * Reject a pending approval.
   */
  async rejectApproval(approvalId: string, superadminId: string, reason: string) {
    const approval = await this.prisma.pendingApproval.findUnique({
      where: { id: approvalId },
    });
    if (!approval) throw new NotFoundException('Approval not found');
    if (approval.status !== ApprovalStatus.PENDING) {
      throw new BadRequestException('Approval already processed');
    }

    // Revert preliminary changes based on action type
    switch (approval.actionType) {
      case 'ban_user':
        // Revert from PENDING_SUSPENSION back to ACTIVE
        await this.prisma.user.update({
          where: { id: approval.targetId },
          data: { status: 'ACTIVE' },
        });
        break;

      case 'hard_delete_user':
        // Revert soft-delete
        await this.prisma.user.update({
          where: { id: approval.targetId },
          data: { deletedAt: null },
        });
        break;

      case 'payout_request':
        // Refund wallet balance
        const rejectPayload = approval.payload as any;
        if (rejectPayload?.amount && rejectPayload?.userId && rejectPayload?.idempotencyKey) {
          await this.prisma.$transaction([
            this.prisma.user.update({
              where: { id: rejectPayload.userId },
              data: { walletBalance: { increment: rejectPayload.amount } },
            }),
            this.prisma.ledger.update({
              where: { referenceId: rejectPayload.idempotencyKey },
              data: { status: 'rejected' },
            }),
          ]);
        }
        break;
    }

    await this.prisma.pendingApproval.update({
      where: { id: approvalId },
      data: {
        status: ApprovalStatus.REJECTED,
        rejectionReason: reason,
        reviewedById: superadminId,
        reviewedAt: new Date(),
      },
    });

    await this.notifications.createNotification(
      approval.requestedById,
      'Approval Rejected',
      `Your ${approval.actionType} request was rejected. Reason: ${reason}`,
      'approval_result',
    );

    return { message: 'Approval rejected' };
  }

  // =============================================
  // ADMIN MANAGEMENT
  // =============================================

  async createAdmin(dto: { name: string; email: string; phone?: string }) {
    return this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        role: Role.ADMIN,
      },
    });
  }

  async deleteAdmin(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.role !== Role.ADMIN) {
      throw new BadRequestException('User is not an admin');
    }
    await this.prisma.user.delete({ where: { id } });
    return { message: 'Admin deleted' };
  }

  async getAdminActivity(adminId: string, page = 1, limit = 50) {
    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { userId: adminId },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where: { userId: adminId } }),
    ]);

    return { data, total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / limit) };
  }

  // =============================================
  // SYSTEM CONFIG
  // =============================================

  async getSystemConfig() {
    let config = await this.prisma.systemConfig.findUnique({
      where: { id: 'default' },
    });
    if (!config) {
      config = await this.prisma.systemConfig.create({ data: { id: 'default' } });
    }
    return config;
  }

  async updateSystemConfig(dto: any) {
    return this.prisma.systemConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...dto },
      update: dto,
    });
  }

  // =============================================
  // AUDIT LOG
  // =============================================

  async getAuditLog(filters: {
    userId?: string;
    action?: string;
    targetTable?: string;
    page?: number;
    limit?: number;
  }) {
    const { userId, action, targetTable, page = 1, limit = 50 } = filters;
    const where: any = {};
    if (userId) where.userId = userId;
    if (action) where.action = { contains: action };
    if (targetTable) where.targetTable = targetTable;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { name: true, email: true, role: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / limit) };
  }
}
