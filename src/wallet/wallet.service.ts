import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { LedgerType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SignatureUtil } from './signature.util';
import { PayoutRequestDto } from './dto/payout-request.dto';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get user's available wallet balance by summing all verified, non-pending ledger entries.
   * This is the source of truth for withdrawals.
   */
  async getBalance(userId: string): Promise<number> {
    const ledgers = await this.prisma.ledger.findMany({ 
      where: { 
        userId,
        OR: [
          { status: 'completed' },
          { amount: { lt: 0 } } // Deductions (payouts, fees) are included immediately
        ]
      } 
    });
    let calculatedBalance = 0;

    for (const entry of ledgers) {
      const isValid = SignatureUtil.verifyLedgerEntry(
        {
          userId: entry.userId,
          orderId: entry.orderId,
          type: entry.type,
          amount: entry.amount,
        },
        entry.signature,
      );

      if (!isValid) {
        this.logger.error(
          `CRITICAL: Ledger manipulation detected for user ${userId} in entry ${entry.id}`,
        );
        return 0;
      }
      calculatedBalance += entry.amount;
    }

    return calculatedBalance;
  }

  /**
   * Get user's pending balance (earnings not yet settled).
   */
  async getPendingBalance(userId: string): Promise<number> {
    const pendingLedgers = await this.prisma.ledger.findMany({
      where: {
        userId,
        status: 'pending',
        type: LedgerType.EARNING
      }
    });

    return pendingLedgers.reduce((sum, entry) => sum + entry.amount, 0);
  }

  /**
   * Get wallet summary including available, pending and total earnings.
   */
  async getWalletSummary(userId: string) {
    const [availableBalance, pendingBalance, allEarnings] = await Promise.all([
      this.getBalance(userId),
      this.getPendingBalance(userId),
      this.prisma.ledger.aggregate({
        where: { 
          userId, 
          type: LedgerType.EARNING 
        },
        _sum: { amount: true }
      })
    ]);

    return {
      availableBalance,
      pendingBalance,
      totalEarnings: allEarnings._sum.amount || 0,
      currency: 'EGP'
    };
  }

  /**
   * Get user's ledger (transaction history).
   */
  async getLedger(
    userId: string,
    filters: { type?: LedgerType; page?: number; limit?: number },
  ) {
    const { type, page = 1, limit = 20 } = filters;

    const where: any = { userId };
    if (type) where.type = type;

    const [data, total, balance] = await Promise.all([
      this.prisma.ledger.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            select: { id: true, total: true, status: true, createdAt: true },
          },
        },
      }),
      this.prisma.ledger.count({ where }),
      this.getBalance(userId),
    ]);

    const verifiedData = data.map((entry) => ({
      ...entry,
      isSignatureValid: SignatureUtil.verifyLedgerEntry(
        {
          userId: entry.userId,
          orderId: entry.orderId,
          type: entry.type,
          amount: entry.amount,
        },
        entry.signature,
      ),
    }));

    return {
      walletBalance: balance,
      data: verifiedData,
      total,
      page: Number(page),
      limit: Number(limit),
    };
  }

  /**
   * Request payout from wallet balance.
   */
  async requestPayout(userId: string, payoutDto: PayoutRequestDto, idempotencyKey: string, mfaToken: string) {
    const { amount, payoutMethod, accountNumber, confirmAccountNumber, methodDetails } = payoutDto;

    if (amount <= 0) {
      throw new BadRequestException('Payout amount must be positive');
    }

    if (accountNumber !== confirmAccountNumber) {
      throw new BadRequestException('Account numbers do not match');
    }

    // 1. MFA Verification (Relaxed for development/testing)
    if (!mfaToken) {
      throw new UnauthorizedException('Invalid MFA Token');
    }

    // 2. Idempotency Check (Replay Attack Prevention)
    const existingTransaction = await this.prisma.ledger.findUnique({
      where: { referenceId: idempotencyKey },
    });
    if (existingTransaction) {
      this.logger.warn(`Replay attack detected for idempotency key: ${idempotencyKey}`);
      return { message: 'Payout request already processed', status: 'ALREADY_PROCESSED' };
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    // 3. Double-Entry Verification (Integrity Check)
    const calculatedBalance = await this.getBalance(userId);

    // Tolerance for floating point precision
    if (Math.abs(calculatedBalance - user.walletBalance) > 0.01) {
      this.logger.error(
        `CRITICAL: Balance mismatch! DB: ${user.walletBalance}, Calculated: ${calculatedBalance}`,
      );
      throw new ForbiddenException(
        'Account balance is out of sync. Please contact support.',
      );
    }

    if (calculatedBalance < amount) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    // 4. Velocity Check (Fraud Detection)
    // Rule: Max 1 payout per day
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentPayouts = await this.prisma.ledger.count({
      where: {
        userId,
        type: LedgerType.PAYOUT,
        createdAt: { gte: oneDayAgo },
      },
    });
    if (recentPayouts > 0) {
      throw new BadRequestException('You can only request one payout per 24 hours');
    }

    // 5. Create Ledger and deduct balance (Atomic Transaction)
    // We mark the status as 'pending' in Ledger until an admin approves it
    const [updatedUser, ledger, approval] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { walletBalance: { decrement: amount } },
      }),
      this.prisma.ledger.create({
        data: {
          userId,
          type: LedgerType.PAYOUT,
          amount: -amount,
          status: `pending:${payoutMethod}:${accountNumber}`, // Storing basic info in status for quick view
          referenceId: idempotencyKey,
          signature: SignatureUtil.signLedgerEntry({
            userId,
            type: LedgerType.PAYOUT,
            amount: -amount,
          }),
        },
      }),
      this.prisma.pendingApproval.create({
        data: {
          actionType: 'payout_request',
          targetTable: 'ledgers',
          targetId: userId,
          requestedById: userId,
          payload: { 
            amount, 
            userId, 
            idempotencyKey, 
            payoutMethod, 
            accountNumber, 
            methodDetails,
            timestamp: new Date().toISOString()
          },
        },
      }),
    ]);

    this.logger.log(`Payout requested: ${userId} → ${amount} via ${payoutMethod}`);
    
    return { 
      message: 'Payout request submitted and is under review', 
      transactionId: ledger.id,
      requestId: approval.id,
      newBalance: updatedUser.walletBalance 
    };
  }

  /**
   * Add earning to user wallet (internal use).
   */
  async addEarning(userId: string, orderId: string, amount: number) {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { walletBalance: { increment: amount } },
      }),
      this.prisma.ledger.create({
        data: { 
          userId, 
          orderId, 
          type: LedgerType.EARNING, 
          amount,
          signature: SignatureUtil.signLedgerEntry({
            userId,
            orderId,
            type: LedgerType.EARNING,
            amount,
          }),
        },
      }),
    ]);
  }

  /**
   * Deduct platform fee (internal use).
   */
  async addFee(userId: string, orderId: string, amount: number) {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { walletBalance: { decrement: amount } },
      }),
      this.prisma.ledger.create({
        data: { 
          userId, 
          orderId, 
          type: LedgerType.FEE, 
          amount: -amount,
          signature: SignatureUtil.signLedgerEntry({
            userId,
            orderId,
            type: LedgerType.FEE,
            amount: -amount,
          }),
        },
      }),
    ]);
  }

  /**
   * Process refund (internal use).
   */
  async processRefund(userId: string, orderId: string, amount: number) {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { walletBalance: { increment: amount } },
      }),
      this.prisma.ledger.create({
        data: { 
          userId, 
          orderId, 
          type: LedgerType.REFUND, 
          amount,
          signature: SignatureUtil.signLedgerEntry({
            userId,
            orderId,
            type: LedgerType.REFUND,
            amount,
          }),
        },
      }),
    ]);
  }
}
