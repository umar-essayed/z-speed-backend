import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import {
  EmailRegisterDto,
  EmailLoginDto,
  SocialAuthDto,
  PhoneSendOtpDto,
  PhoneVerifyOtpDto,
  DebugLoginDto,
} from './dto/auth.dto';

@ApiTags('🔐 Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // EMAIL / PASSWORD
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/auth/email/register
   * تسجيل حساب جديد بالبريد الإلكتروني وكلمة المرور
   */
  @Post('email/register')
  @ApiOperation({ summary: 'Register with email & password' })
  @ApiResponse({ status: 201, description: 'Account created successfully' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async emailRegister(
    @Req() req: any,
    @Body() dto: EmailRegisterDto,
    @Res({ passthrough: true }) res: any,
  ) {
    return this.authService.emailRegister(req, dto, res);
  }

  /**
   * POST /api/v1/auth/email/login
   * تسجيل الدخول بالبريد الإلكتروني وكلمة المرور
   */
  @Post('email/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email & password' })
  @ApiResponse({ status: 200, description: 'Logged in successfully' })
  @ApiResponse({ status: 401, description: 'Wrong credentials' })
  async emailLogin(
    @Req() req: any,
    @Body() dto: EmailLoginDto,
    @Res({ passthrough: true }) res: any,
  ) {
    return this.authService.emailLogin(req, dto, res);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SOCIAL AUTH (Google / Apple)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/auth/social/google
   * تسجيل الدخول بحساب جوجل
   */
  @Post('social/google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with Google' })
  async googleSignIn(
    @Req() req: any,
    @Body() dto: SocialAuthDto,
    @Res({ passthrough: true }) res: any,
  ) {
    return this.authService.socialSignIn(req, 'google', dto, res);
  }

  /**
   * POST /api/v1/auth/social/apple
   * تسجيل الدخول بحساب آبل
   */
  @Post('social/apple')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with Apple' })
  async appleSignIn(
    @Req() req: any,
    @Body() dto: SocialAuthDto,
    @Res({ passthrough: true }) res: any,
  ) {
    return this.authService.socialSignIn(req, 'apple', dto, res);
  }

  /**
   * GET /api/v1/auth/social/google/login
   * Server-side redirect to Google OAuth consent screen via Supabase
   */
  @Get('social/google/login')
  @ApiOperation({ summary: 'Redirect to Google OAuth consent screen' })
  async googleOAuthRedirect(@Res() res: Response) {
    const url = await this.authService.getGoogleOAuthUrl();
    return res.redirect(url);
  }

  @Post('social/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange Supabase access token for custom JWTs' })
  async oauthCallback(
    @Body() body: { access_token: string }
  ) {
    if (!body.access_token) {
      throw new BadRequestException('Access token is required');
    }
    return this.authService.handleOAuthCallback(body.access_token);
  }

  @Post('social/complete-registration')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete social registration by setting user role' })
  async completeSocialRegistration(
    @CurrentUser('dbUserId') userId: string,
    @Body() dto: { role: string; name?: string },
  ) {
    return this.authService.updateProfile(userId, dto);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PHONE OTP (Redis / CloudOTP)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/auth/phone/send-otp
   * إرسال رمز التحقق للهاتف عبر CloudOTP
   */
  @Post('phone/send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send OTP to phone number' })
  async sendPhoneOtp(
    @Body() dto: PhoneSendOtpDto,
    @CurrentUser('dbUserId') userId?: string,
  ) {
    return this.authService.sendPhoneOtp(dto, userId);
  }

  /**
   * POST /api/v1/auth/phone/verify-otp
   * التحقق من رمز الهاتف
   */
  @Post('phone/verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify phone OTP and link phone to account' })
  async verifyPhoneOtp(
    @Body() dto: PhoneVerifyOtpDto,
    @CurrentUser('dbUserId') userId?: string,
  ) {
    return this.authService.verifyPhoneOtp(dto, userId);
  }

  /**
   * POST /api/v1/auth/email/send-otp
   */
  @Post('email/send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send OTP to email' })
  async sendEmailOtp(
    @Body('email') email: string,
    @CurrentUser('dbUserId') userId?: string,
  ) {
    return this.authService.sendEmailOtp(email, userId);
  }

  /**
   * POST /api/v1/auth/email/verify-otp
   */
  @Post('email/verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email OTP' })
  async verifyEmailOtp(
    @Body('email') email: string,
    @Body('code') code: string,
    @CurrentUser('dbUserId') userId?: string,
  ) {
    return this.authService.verifyEmailOtp(email, code, userId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SESSION
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/auth/logout
   * تسجيل الخروج وإلغاء الجلسة
   */
  @Post('logout')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and revoke session' })
  async logout(
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    return this.authService.logout(req, res);
  }

  /**
   * GET /api/v1/auth/profile
   * جلب بيانات المستخدم الحالي
   */
  @Get('profile')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile(@CurrentUser('dbUserId') userId: string) {
    return this.authService.getCurrentUser(userId);
  }

  /**
   * POST /api/v1/auth/refresh
   * تجديد رمز الوصول باستخدام رمز التجديد
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiResponse({ status: 200, description: 'Tokens refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refreshToken(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }

  /**
   * POST /api/v1/auth/forgot-password
   * طلب إعادة تعيين كلمة المرور
   */
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset email' })
  async forgotPassword(@Body('email') email: string) {
    return this.authService.forgotPassword(email);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DEBUG ONLY
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/auth/debug-login
   * ⚠️ للتطوير فقط — دخول فوري بدون مصادقة
   */
  @Post('debug-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '⚠️ DEBUG ONLY — Instant login bypass' })
  async debugLogin(
    @Req() req: any,
    @Body() dto: DebugLoginDto,
    @Res({ passthrough: true }) res: any,
  ) {
    return this.authService.debugLogin(req, dto, res);
  }
}
