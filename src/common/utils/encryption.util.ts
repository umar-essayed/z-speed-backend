import * as crypto from 'crypto';

/**
 * Utility for AES-256-GCM encryption for data at rest (e.g. bank info, payout phones).
 */
export class EncryptionUtil {
  // In production, this must be a 32-byte secret loaded from ENV
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly SECRET_KEY = process.env.ENCRYPTION_KEY || 'default_secret_key_32_bytes_long_';

  static encrypt(text: string): string {
    const iv = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipheriv(
      this.ALGORITHM,
      Buffer.from(this.SECRET_KEY.padEnd(32, '0').slice(0, 32)),
      iv,
    );

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    // Return IV:EncryptedText:AuthTag
    return `${iv.toString('hex')}:${encrypted}:${authTag}`;
  }

  static decrypt(encryptedText: string): string {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted format');
    }

    const [ivHex, encryptedHex, authTagHex] = parts;
    const decipher = crypto.createDecipheriv(
      this.ALGORITHM,
      Buffer.from(this.SECRET_KEY.padEnd(32, '0').slice(0, 32)),
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
