import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import { Role, AccountStatus } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import * as appleSignin from 'apple-signin-auth';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';
import { SupabaseService } from '../common/supabase/supabase.service';
import { MailerService } from '../mailer/mailer.service';
import {
  EmailRegisterDto,
  EmailLoginDto,
  SocialAuthDto,
  PhoneSendOtpDto,
  PhoneVerifyOtpDto,
  DebugLoginDto,
} from './dto/auth.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private googleClient: OAuth2Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly otpService: OtpService,
    private readonly supabaseService: SupabaseService,
    private readonly jwtService: JwtService,
    private readonly mailerService: MailerService,
  ) {
    this.googleClient = new OAuth2Client(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HELPERS — JWT Token Generation
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Generate our own access + refresh tokens.
   * These are the tokens the frontend will use — NOT Supabase tokens directly.
   */
  private generateTokens(user: { id: string; role: Role; email: string }) {
    const payload = { sub: user.id, dbUserId: user.id, role: user.role, email: user.email };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN', '15m') as any,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET', 'refresh-secret'),
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d') as any,
    });

    return { accessToken, refreshToken };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // EMAIL / PASSWORD AUTH
  // ─────────────────────────────────────────────────────────────────────────────

  async emailRegister(req: any, dto: EmailRegisterDto, res: Response) {
    this.logger.log(`emailRegister: ${dto.email} as ${dto.role}`);

    // Check if email already exists in our DB
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('البريد الإلكتروني مسجّل بالفعل');
    }

    // Create user in Supabase Auth
    const { data: supabaseUser, error: supabaseError } =
      await this.supabaseService.authAdmin.createUser({
        email: dto.email,
        password: dto.password,
        email_confirm: true, // We handle verification ourselves via OTP
        user_metadata: {
          name: dto.name,
          role: dto.role ?? Role.CUSTOMER,
        },
      });

    if (supabaseError) {
      this.logger.error(`Supabase createUser failed: ${supabaseError.message}`);
      if (supabaseError.message.includes('already been registered')) {
        throw new ConflictException('البريد الإلكتروني مسجّل بالفعل');
      }
      throw new BadRequestException('فشل إنشاء الحساب');
    }

    // Create user in our local DB
    const user = await this.prisma.user.create({
      data: {
        supabaseId: supabaseUser.user.id,
        email: dto.email,
        name: dto.name,
        role: dto.role ?? Role.CUSTOMER,
        status: AccountStatus.ACTIVE,
        emailVerified: true,
        authProvider: 'email',
      },
    });

    const tokens = this.generateTokens(user);

    return {
      message: 'تم إنشاء الحساب بنجاح',
      user: this.formatUser(user),
      ...tokens,
    };
  }

  async emailLogin(req: any, dto: EmailLoginDto, res: Response) {
    this.logger.log(`emailLogin: ${dto.email}`);

    // Sign in via Supabase Auth to validate credentials
    const { data, error } = await this.supabaseService.signInWithPassword(
      dto.email,
      dto.password,
    );

    if (error) {
      this.logger.warn(`Supabase signIn failed for ${dto.email}: ${error.message}`);
      throw new UnauthorizedException('البريد الإلكتروني أو كلمة المرور غير صحيحة');
    }

    // Find user in our DB
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      // Edge case: user exists in Supabase but not in our DB — sync them
      const newUser = await this.prisma.user.create({
        data: {
          supabaseId: data.user.id,
          email: dto.email,
          name: data.user.user_metadata?.name ?? dto.email.split('@')[0],
          role: (data.user.user_metadata?.role as Role) ?? Role.CUSTOMER,
          status: AccountStatus.ACTIVE,
          emailVerified: true,
          authProvider: 'email',
        },
      });
      const tokens = this.generateTokens(newUser);
      return {
        message: 'تم تسجيل الدخول بنجاح',
        user: this.formatUser(newUser),
        ...tokens,
      };
    }

    if (user.status === AccountStatus.BANNED) {
      throw new UnauthorizedException('تم حظر هذا الحساب');
    }

    // Ensure supabaseId is synced
    if (!user.supabaseId) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { supabaseId: data.user.id },
      });
    }

    const tokens = this.generateTokens(user);

    return {
      message: 'تم تسجيل الدخول بنجاح',
      user: this.formatUser(user),
      ...tokens,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SOCIAL AUTH (Google / Apple)
  // ─────────────────────────────────────────────────────────────────────────────

  async socialSignIn(
    req: any,
    provider: 'google' | 'apple',
    dto: SocialAuthDto,
    res: Response,
  ) {
    this.logger.log(`socialSignIn: provider=${provider}`);

    let email: string;
    let externalId: string;
    let name: string | undefined = dto.name;
    let profileImage: string | undefined;

    if (provider === 'google') {
      const payload = await this.verifyGoogleToken(dto.token);
      if (!payload || !payload.email) {
        throw new UnauthorizedException('فشل التحقق من حساب جوجل أو البريد الإلكتروني غير متوفر');
      }
      email = payload.email;
      externalId = payload.sub;
      name = name || payload.name || payload.given_name;
      profileImage = payload.picture;
    } else {
      const payload = await this.verifyAppleToken(dto.token);
      if (!payload || !payload.email) {
        throw new UnauthorizedException('فشل التحقق من حساب آبل أو البريد الإلكتروني غير متوفر');
      }
      email = payload.email;
      externalId = payload.sub;
      // Apple payload doesn't usually have name, we rely on dto.name sent from client on first login
    }

    // Check if user is banned before doing anything
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser && existingUser.status === AccountStatus.BANNED) {
      throw new UnauthorizedException('تم حظر هذا الحساب');
    }

    // Create or find the user in Supabase Auth
    let supabaseUserId: string;

    if (existingUser?.supabaseId) {
      supabaseUserId = existingUser.supabaseId;
    } else {
      // Try to find by email in Supabase, or create a new user
      const { data: existingSbUsers } = await this.supabaseService.authAdmin.listUsers();
      const sbUser = existingSbUsers?.users?.find((u) => u.email === email);

      if (sbUser) {
        supabaseUserId = sbUser.id;
      } else {
        // Create new Supabase Auth user (no password — social-only)
        const { data: newSbUser, error } =
          await this.supabaseService.authAdmin.createUser({
            email,
            email_confirm: true,
            user_metadata: {
              name: name || 'User',
              provider,
              provider_id: externalId,
              avatar_url: profileImage,
            },
          });

        if (error) {
          this.logger.error(`Supabase createUser (social) failed: ${error.message}`);
          throw new UnauthorizedException('فشل تسجيل الدخول الاجتماعي');
        }
        supabaseUserId = newSbUser.user.id;
      }
    }

    // Sync / Create in our local DB
    const isNew = !existingUser;
    const user = await this.prisma.user.upsert({
      where: { email },
      update: {
        supabaseId: supabaseUserId,
        googleId: provider === 'google' ? externalId : undefined,
        appleId: provider === 'apple' ? externalId : undefined,
        name: name || undefined,
        profileImage: profileImage || undefined,
        authProvider: provider,
      },
      create: {
        supabaseId: supabaseUserId,
        email,
        name: name || 'User',
        role: dto.role ?? Role.CUSTOMER,
        status: AccountStatus.ACTIVE,
        emailVerified: true,
        authProvider: provider,
        googleId: provider === 'google' ? externalId : undefined,
        appleId: provider === 'apple' ? externalId : undefined,
        profileImage,
      },
    });

    const tokens = this.generateTokens(user);

    return {
      message: 'تم تسجيل الدخول بنجاح',
      user: this.formatUser(user),
      isNewUser: isNew,
      ...tokens,
    };
  }

  private async verifyGoogleToken(token: string) {
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: token,
        audience: this.configService.get<string>('GOOGLE_CLIENT_ID'),
      });
      return ticket.getPayload();
    } catch (error) {
      this.logger.error(`Google token verification failed: ${error.message}`);
      // If it's not an ID token, maybe it's an access token? (Optional fallback)
      return null;
    }
  }

  private async verifyAppleToken(token: string) {
    try {
      // Apple ID tokens are JWTs. We verify using apple-signin-auth
      const decodedToken = await appleSignin.verifyIdToken(token, {
        audience: this.configService.get<string>('APPLE_CLIENT_ID'),
        ignoreExpiration: false,
      });
      return decodedToken;
    } catch (error) {
      this.logger.error(`Apple token verification failed: ${error.message}`);
      return null;
    }
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // STRICT BACKEND-DRIVEN SOCIAL AUTH FLOW (OAuth)
  // ─────────────────────────────────────────────────────────────────────────────

  async getGoogleOAuthUrl() {
    const websiteDomain = this.configService.get<string>('WEBSITE_DOMAIN', 'http://localhost:5173');
    const redirectTo = `${websiteDomain}/auth/callback`;

    const { data, error } = await this.supabaseService.signInWithOAuth('google', redirectTo);

    if (error || !data?.url) {
      this.logger.error(`Failed to get Google OAuth URL: ${error?.message}`);
      throw new UnauthorizedException('Failed to initiate Google sign-in');
    }

    return data.url;
  }

  async handleOAuthCallback(accessToken: string) {
    // Verify the Supabase access token directly
    const { data, error } = await this.supabaseService.admin.auth.getUser(accessToken);

    if (error || !data.user) {
      this.logger.error(`Failed to get user from token: ${error?.message}`);
      throw new UnauthorizedException('Authentication failed');
    }

    const sbUser = data.user;
    const email = sbUser.email;
    const name = sbUser.user_metadata?.full_name || sbUser.user_metadata?.name || 'User';

    if (!email) {
      throw new UnauthorizedException('No email provided by OAuth provider');
    }

    // Try to find an existing user or create a new one
    let user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Create the user in our DB if they don't exist
      user = await this.prisma.user.create({
        data: {
          email,
          name,
          role: Role.CUSTOMER,
          supabaseId: sbUser.id,
          emailVerified: true,
          authProvider: 'google',
        },
      });
    } else if (!user.supabaseId) {
      // Link the existing user to this Supabase ID
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { supabaseId: sbUser.id },
      });
    }

    // Generate our own JWT tokens
    const tokens = this.generateTokens(user);

    return {
      message: 'تم تسجيل الدخول بنجاح',
      user: this.formatUser(user),
      ...tokens,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PHONE OTP (CloudOTP + Redis)
  // ─────────────────────────────────────────────────────────────────────────────

  async sendPhoneOtp(dto: PhoneSendOtpDto, userId?: string) {
    this.logger.log(`sendPhoneOtp: ${dto.phone} for user ${userId}`);

    if (userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('المستخدم غير موجود');

      // Check if phone already taken
      const existingPhone = await this.prisma.user.findFirst({
        where: { phone: dto.phone, id: { not: userId } },
      });
      if (existingPhone) {
        throw new ConflictException('رقم الهاتف مستخدم بالفعل');
      }
    }

    await this.otpService.sendOtp(dto.phone);
    return { message: 'تم إرسال رمز التحقق' };
  }

  async verifyPhoneOtp(dto: PhoneVerifyOtpDto, userId?: string) {
    this.logger.log(`verifyPhoneOtp: ${dto.phone} for user ${userId}`);

    const isValid = await this.otpService.verifyOtp(dto.phone, dto.code);
    if (!isValid) throw new UnauthorizedException('رمز التحقق غير صحيح أو منتهي الصلاحية');

    // Check if user exists before updating
    const user = await this.prisma.user.findUnique({
      where: userId ? { id: userId } : { phone: dto.phone },
    });

    if (user) {
      const updatedUser = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          phone: dto.phone,
          phoneVerified: true,
          isPhoneVerified: true,
        },
      });
      return {
        message: 'تم التحقق من رقم الهاتف بنجاح',
        user: this.formatUser(updatedUser),
      };
    }

    return {
      message: 'تم التحقق من رقم الهاتف بنجاح (مرحلة التسجيل)',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // EMAIL OTP
  // ─────────────────────────────────────────────────────────────────────────────

  async sendEmailOtp(email: string, userId?: string) {
    this.logger.log(`sendEmailOtp: ${email} for user ${userId}`);

    // If userId is provided, ensure user exists
    if (userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('المستخدم غير موجود');
    } else {
      // If no userId, check if email exists (optional, depending on flow)
      const user = await this.prisma.user.findUnique({ where: { email } });
      if (!user) {
        this.logger.warn(`OTP requested for non-existent email: ${email}`);
        // We still send OTP if we want to allow verification during registration
        // or throw error if it's strictly for existing users.
        // For now, let's allow it but log a warning.
      }
    }

    // Generate and cache code via OtpService
    const code = await this.otpService.sendOtp(email);

    // In dev mode skip real email sending (no SMTP / templates configured)
    if (this.configService.get<string>('NODE_ENV') === 'development') {
      this.logger.warn(`[DEV MODE] Email OTP for ${email}: ${code} (use 123456 as master code)`);
    } else {
      await this.mailerService.sendOtpEmail(email, code);
    }

    return { message: 'تم إرسال رمز التحقق إلى البريد الإلكتروني' };
  }

  async verifyEmailOtp(email: string, code: string, userId?: string) {
    this.logger.log(`verifyEmailOtp: ${email} for user ${userId}`);

    const isValid = await this.otpService.verifyOtp(email, code);
    if (!isValid) throw new UnauthorizedException('رمز التحقق غير صحيح أو منتهي الصلاحية');

    // Check if user exists before updating
    const user = await this.prisma.user.findUnique({
      where: userId ? { id: userId } : { email: email },
    });

    if (user) {
      const updatedUser = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerified: true,
        },
      });
      return {
        message: 'تم التحقق من البريد الإلكتروني بنجاح',
        user: this.formatUser(updatedUser),
      };
    }

    return {
      message: 'تم التحقق من البريد الإلكتروني بنجاح (مرحلة التسجيل)',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SESSION MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────────

  async logout(req: any, res: Response) {
    // Extract user ID and sign them out from Supabase
    const userId = req.user?.dbUserId;
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { supabaseId: true },
      });
      if (user?.supabaseId) {
        try {
          await this.supabaseService.authAdmin.signOut(user.supabaseId);
        } catch (err) {
          this.logger.warn(`Supabase signOut failed: ${err.message}`);
        }
      }
    }
    return { message: 'تم تسجيل الخروج بنجاح' };
  }

  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('المستخدم غير موجود');
    return { user: this.formatUser(user) };
  }

  async refreshToken(refreshTokenValue: string) {
    try {
      const payload = this.jwtService.verify(refreshTokenValue, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET', 'refresh-secret'),
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) throw new UnauthorizedException('المستخدم غير موجود');
      if (user.status === AccountStatus.BANNED) {
        throw new UnauthorizedException('تم حظر هذا الحساب');
      }

      const tokens = this.generateTokens(user);
      return {
        message: 'تم تجديد الجلسة بنجاح',
        ...tokens,
      };
    } catch (error) {
      throw new UnauthorizedException('رمز التجديد غير صالح أو منتهي الصلاحية');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FORGOT / RESET PASSWORD — via Supabase
  // ─────────────────────────────────────────────────────────────────────────────

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Don't reveal if email exists
    if (!user || user.authProvider !== 'email') {
      return { message: 'إذا كان البريد مسجلاً، ستصلك رسالة إعادة تعيين كلمة المرور' };
    }

    try {
      const redirectTo = this.configService.get<string>(
        'SUPABASE_REDIRECT_URI',
        'http://localhost:5173/auth/reset-password',
      );
      await this.supabaseService.resetPasswordForEmail(email, redirectTo);
    } catch (err) {
      this.logger.error(`forgotPassword error: ${err.message}`);
    }

    return { message: 'إذا كان البريد مسجلاً، ستصلك رسالة إعادة تعيين كلمة المرور' };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DEBUG LOGIN — for development only
  // ─────────────────────────────────────────────────────────────────────────────

  async debugLogin(req: any, dto: DebugLoginDto, res: Response) {
    if (this.configService.get<string>('NODE_ENV') === 'production') {
      throw new UnauthorizedException('غير متاح في بيئة الإنتاج');
    }

    const email = dto.email ?? 'debug@zspeed.app';
    const role = (dto.role as Role) ?? Role.ADMIN;

    this.logger.warn(`🚨 DEBUG LOGIN triggered for: ${email} as ${role}`);

    // Find or create the user directly in DB — no external auth needed
    let user = await this.prisma.user.findFirst({ where: { email } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          supabaseId: `debug-${Date.now()}`,
          email,
          name: 'Debug User',
          role,
          status: AccountStatus.ACTIVE,
          emailVerified: true,
          authProvider: 'email',
        },
      });
    }

    const tokens = this.generateTokens(user);

    return {
      message: '✅ Debug login successful (JWT mode — no external auth required)',
      user: this.formatUser(user),
      ...tokens,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PROFILE
  // ─────────────────────────────────────────────────────────────────────────────

  async updateProfile(userId: string, dto: { role?: string; name?: string }) {
    this.logger.log(`updateProfile: user=${userId}`);

    const data: Record<string, any> = {};
    if (dto.role) data.role = dto.role as Role;
    if (dto.name) data.name = dto.name;

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
    });

    return { message: 'تم تحديث الملف الشخصي بنجاح', user: this.formatUser(user) };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  private formatUser(user: any) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified || user.isPhoneVerified,
      profileImage: user.profileImage,
      walletBalance: user.walletBalance,
      loyaltyPoints: user.loyaltyPoints,
      authProvider: user.authProvider,
    };
  }
}
