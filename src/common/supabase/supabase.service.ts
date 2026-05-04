import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * SupabaseService — Server-side only Supabase admin client.
 *
 * Uses SERVICE_ROLE_KEY to perform privileged operations:
 *   - Create / delete users
 *   - Sign in on behalf of users
 *   - Manage user metadata
 *
 * ⚠️  NEVER expose the service-role key or this client to the frontend.
 */
@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private _adminClient: SupabaseClient;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const serviceRoleKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      this.logger.error(
        '⚠️  SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. Auth will not work!',
      );
      return;
    }

    this._adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    this.logger.log('✅ Supabase admin client initialized successfully');
  }

  /** The privileged admin client — use for all server-side auth operations */
  get admin(): SupabaseClient {
    if (!this._adminClient) {
      throw new Error('Supabase admin client not initialized. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    }
    return this._adminClient;
  }

  /** Convenience: access the Supabase Auth Admin API directly */
  get authAdmin() {
    return this.admin.auth.admin;
  }

  /**
   * Sign in with email/password — delegates to Supabase Auth.
   * Returns the full auth response including session tokens.
   */
  async signInWithPassword(email: string, password: string) {
    return this.admin.auth.signInWithPassword({ email, password });
  }

  /**
   * Reset password for email — sends a password reset email via Supabase.
   */
  async resetPasswordForEmail(email: string, redirectTo?: string) {
    return this.admin.auth.resetPasswordForEmail(email, { redirectTo });
  }

  /**
   * Refresh a session using a refresh token.
   */
  async refreshSession(refreshToken: string) {
    return this.admin.auth.refreshSession({ refresh_token: refreshToken });
  }

  /**
   * Get the OAuth sign-in URL for a specific provider.
   */
  async signInWithOAuth(provider: 'google' | 'apple', redirectTo: string) {
    return this.admin.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
      },
    });
  }

  /**
   * Exchange an OAuth code for a session.
   */
  async exchangeCodeForSession(code: string) {
    return this.admin.auth.exchangeCodeForSession(code);
  }
}
