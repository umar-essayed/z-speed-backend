import { Injectable, BadRequestException } from '@nestjs/common';
import { OrderStatus, Role } from '@prisma/client';

/**
 * Manages valid order status transitions based on the user's role.
 */
@Injectable()
export class OrderStateMachineService {
  private readonly allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
    [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
    [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
    [OrderStatus.PREPARING]: [OrderStatus.READY, OrderStatus.CANCELLED],
    [OrderStatus.READY]: [OrderStatus.READY_FOR_PICKUP, OrderStatus.PICKED_UP],
    [OrderStatus.READY_FOR_PICKUP]: [OrderStatus.PICKED_UP],
    [OrderStatus.PICKED_UP]: [OrderStatus.IN_TRANSIT, OrderStatus.ARRIVED],
    [OrderStatus.IN_TRANSIT]: [OrderStatus.ARRIVED],
    [OrderStatus.ARRIVED]: [OrderStatus.DELIVERED],
    [OrderStatus.IN_PROGRESS]: [OrderStatus.ARRIVED, OrderStatus.DELIVERED, OrderStatus.CANCELLED],
    [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
    [OrderStatus.RETURNED]: [],
    [OrderStatus.DELIVERED]: [],
    [OrderStatus.CANCELLED]: [],
  };

  /**
   * Check if a transition from `from` to `to` is valid for the given role.
   */
  canTransition(from: OrderStatus, to: OrderStatus, userRole: Role): boolean {
    const allowed = this.allowedTransitions[from];
    if (!allowed || !allowed.includes(to)) {
      return false;
    }

    // Role-based restrictions
    switch (to) {
      case OrderStatus.CONFIRMED:
      case OrderStatus.PREPARING:
      case OrderStatus.READY:
      case OrderStatus.READY_FOR_PICKUP:
        // Only VENDOR or ADMIN
        return ([Role.VENDOR, Role.ADMIN, Role.SUPERADMIN] as Role[]).includes(userRole);

      case OrderStatus.PICKED_UP:
      case OrderStatus.IN_TRANSIT:
      case OrderStatus.ARRIVED:
      case OrderStatus.IN_PROGRESS:
      case OrderStatus.OUT_FOR_DELIVERY:
      case OrderStatus.DELIVERED:
        // Only DRIVER or ADMIN
        return ([Role.DRIVER, Role.ADMIN, Role.SUPERADMIN] as Role[]).includes(userRole);

      case OrderStatus.CANCELLED:
        // CUSTOMER (before PREPARING), VENDOR, ADMIN
        return ([
          Role.CUSTOMER,
          Role.VENDOR,
          Role.ADMIN,
          Role.SUPERADMIN,
        ] as Role[]).includes(userRole);

      default:
        // Any other state transitions (if any) are not allowed by default
        return false;
    }
  }

  /**
   * Validate and throw if the transition is not allowed.
   */
  validateTransition(from: OrderStatus, to: OrderStatus, userRole: Role) {
    if (from === to) return; // Ignore same-state transitions
    
    if (!this.canTransition(from, to, userRole)) {
      throw new BadRequestException(
        `Cannot transition order from ${from} to ${to} with role ${userRole}`,
      );
    }
  }
}
