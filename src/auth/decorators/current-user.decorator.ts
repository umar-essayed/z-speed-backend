import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts the current authenticated user's DB id and role from the JWT payload.
 * Usage: @CurrentUser() user: { dbUserId: string; role: Role }
 *        @CurrentUser('dbUserId') userId: string
 */
export const CurrentUser = createParamDecorator(
  (field: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return null;

    return field ? (user as any)[field] : user;
  },
);
