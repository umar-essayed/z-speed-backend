import * as crypto from 'crypto';

export class SignatureUtil {
  private static readonly SECRET = process.env.LEDGER_SECRET || 'z-speed-default-ledger-secret-123';

  static signLedgerEntry(data: {
    userId: string;
    orderId?: string | null;
    type: string;
    amount: number;
  }): string {
    const payload = `${data.userId}:${data.orderId || ''}:${data.type}:${data.amount.toFixed(4)}`;
    return crypto.createHmac('sha256', this.SECRET).update(payload).digest('hex');
  }

  static verifyLedgerEntry(
    data: {
      userId: string;
      orderId?: string | null;
      type: string;
      amount: number;
    },
    signature: string | null,
  ): boolean {
    if (!signature) return false;
    const expected = this.signLedgerEntry(data);
    // Use timingSafeEqual to prevent timing attacks
    const expectedBuffer = Buffer.from(expected, 'hex');
    const signatureBuffer = Buffer.from(signature, 'hex');
    
    if (expectedBuffer.length !== signatureBuffer.length) {
      return false;
    }
    
    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  }
}
