/**
 * JWT Payload interface used across all modules
 */
export interface JwtPayload {
  sub: string; // userId
  role: string; // Role enum value
  iat?: number;
  exp?: number;
}

/**
 * Standardized paginated response
 */
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
}
