import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { OrderStatus, PaymentState, AccountStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStateMachineService } from './order-state-machine.service';
import { RealtimeGateway } from '../gateway/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { CheckoutDto, UpdateOrderStatusDto } from './dto';

import { PromotionsService } from '../promotions/promotions.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { DisputesService } from '../disputes/disputes.service';
import { PaymentsService } from '../payments/payments.service';
import { DriversService } from '../drivers/drivers.service';
import { SignatureUtil } from '../wallet/signature.util';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: OrderStateMachineService,
    private readonly gateway: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly promotionsService: PromotionsService,
    private readonly loyaltyService: LoyaltyService,
    private readonly disputesService: DisputesService,
    private readonly paymentsService: PaymentsService,
    private readonly driversService: DriversService,
  ) {}

  /**
   * Checkout: convert cart to order.
   */
  async checkout(customerId: string, dto: CheckoutDto) {
    // 1. Validate cart is not empty
    const cart = await this.prisma.cart.findUnique({
      where: { customerId },
      include: { items: { include: { foodItem: true } } },
    });
    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    // 1.5 Validate stock and prescriptions
    for (const item of cart.items) {
      if (item.foodItem.stockQuantity < item.quantity) {
        throw new BadRequestException(`Not enough stock for item: ${item.foodItem.name}`);
      }
    }

    // 2. Validate restaurant
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: dto.restaurantId },
    });
    if (!restaurant || restaurant.status !== AccountStatus.ACTIVE) {
      throw new BadRequestException('Restaurant is not available');
    }
    if (!restaurant.isOpen) {
      throw new BadRequestException('Restaurant is currently closed');
    }

    // 3. Validate delivery address
    const address = await this.prisma.address.findFirst({
      where: { id: dto.deliveryAddressId, userId: customerId },
    });
    if (!address) {
      throw new NotFoundException('Delivery address not found');
    }

    // 3.5 Validate geofence & Calculate distance
    let distance = 0;
    if (restaurant.latitude && restaurant.longitude) {
      distance = this.getDistance(
        address.latitude,
        address.longitude,
        restaurant.latitude,
        restaurant.longitude,
      );
      const radius = restaurant.deliveryRadiusKm || 10.0;
      if (distance > radius) {
        throw new BadRequestException('Delivery address is outside the restaurant delivery zone');
      }
    }

    // 4. Calculate totals
    const rawSubtotal = cart.items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );
    const subtotal = Math.round(rawSubtotal * 100) / 100;
    
    // Check minimum order
    if (restaurant.minimumOrder && subtotal < restaurant.minimumOrder) {
      throw new BadRequestException(`Minimum order amount for this restaurant is ${restaurant.minimumOrder} EGP`);
    }

    // Calculate Delivery Fee based on restaurant settings
    const deliveryFee = this.calculateDeliveryFee(restaurant, distance);

    // 4.5 Calculate Service Fee based on restaurant settings
    let serviceFee = 0;
    const r = restaurant as any; // Cast to access new fields before type updates propagate
    if (r.serviceFeeType === 'fixed') {
      serviceFee = r.serviceFeeValue || 0;
    } else if (r.serviceFeeType === 'percentage') {
      serviceFee = Math.round(subtotal * ((r.serviceFeeValue || 0) / 100) * 100) / 100;
    } else {
      // Fallback to system config if not set
      const config = await this.prisma.systemConfig.findUnique({
        where: { id: 'default' },
      });
      const serviceFeePercent = config?.platformFeePercent ?? 2.0;
      serviceFee = Math.round(subtotal * (serviceFeePercent / 100) * 100) / 100;
    }

    // 5. Validate & apply promo code
    let discount = 0;
    let promoId: string | undefined;
    if (dto.promoCode) {
      const promoResult = await this.promotionsService.validate(dto.promoCode, subtotal, customerId);
      discount = promoResult.discount;
      promoId = promoResult.id;
    }

    const total = Math.round((subtotal + deliveryFee + serviceFee - discount) * 100) / 100;

    // 6. Handle payment method
    let paymentState: PaymentState = PaymentState.PENDING;

    if (dto.paymentMethod === 'WALLET') {
      const user = await this.prisma.user.findUnique({ where: { id: customerId } });
      if (!user || user.walletBalance < total) {
        throw new BadRequestException('Insufficient wallet balance');
      }
      // Deduct wallet
      await this.prisma.user.update({
        where: { id: customerId },
        data: { walletBalance: { decrement: total } },
      });
      paymentState = PaymentState.PAID;
    } else if (dto.paymentMethod === 'CASH') {
      paymentState = PaymentState.PENDING;
    } else if (dto.paymentMethod === 'CYBERSOURCE_CARD') {
      if (!dto.transientToken) {
        throw new BadRequestException('Transient token required for card payments');
      }
      paymentState = PaymentState.PENDING;
    }

    // 7. Create order
    const order = await this.prisma.order.create({
      data: {
        customerId,
        restaurantId: dto.restaurantId,
        status: OrderStatus.PENDING,
        subtotal,
        deliveryFee,
        serviceFee,
        discount,
        total,
        paymentMethod: dto.paymentMethod,
        paymentState,
        deliveryAddress: `${address.street}, ${address.city}`,
        deliveryLat: address.latitude,
        deliveryLng: address.longitude,
        customerNote: dto.customerNote,
        items: {
          create: cart.items.map((item) => ({
            foodItem: { connect: { id: item.foodItemId } },
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            selectedAddons: item.selectedAddons ?? undefined,
            specialNote: item.specialNote ?? undefined,
          })),
        },
      },
      include: { items: { include: { foodItem: true } } },
    });

    // 8. Record promo usage
    if (dto.promoCode && promoId) {
      await this.promotionsService.incrementUsage(dto.promoCode);
      await this.prisma.promotionUsage.create({
        data: {
          promotionId: promoId,
          userId: customerId,
          orderId: order.id,
        },
      });
    }

    // 9. Update stock and clear cart
    for (const item of cart.items) {
      await this.prisma.foodItem.update({
        where: { id: item.foodItemId },
        data: { stockQuantity: { decrement: item.quantity } },
      });
    }

    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await this.prisma.cart.update({
      where: { id: cart.id },
      data: { restaurantId: null },
    });

    this.logger.log(`Order created: ${order.id} by customer ${customerId}`);

    // Notify Vendor
    await this.notifications.notifyVendor(dto.restaurantId, order.id);
    this.gateway.emitToVendor(dto.restaurantId, 'order:new', order);

    // 10. If card, initiate payment
    if (dto.paymentMethod === 'CYBERSOURCE_CARD' && dto.transientToken) {
      const paymentResult = await this.paymentsService.initiateFlexPayment(order.id, dto.transientToken);
      if (!paymentResult.success) {
        // Log failure but order remains PENDING/FAILED
        this.logger.error(`Payment failed for order ${order.id}: ${paymentResult.status}`);
      }
    }

    return order;
  }

  /**
   * Validate a promo code and return the discount amount.
   */
  async validatePromo(code: string, subtotal: number, customerId: string) {
    return this.promotionsService.validate(code, subtotal, customerId);
  }

  /**
   * Get customer's orders with pagination.
   */
  async getMyOrders(
    customerId: string,
    filters: { status?: OrderStatus; page?: number; limit?: number },
  ) {
    const { status, page = 1, limit = 20 } = filters;
    const where: any = { customerId };
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          items: { include: { foodItem: true } },
          restaurant: { select: { id: true, name: true, logoUrl: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data,
      total,
      page: Number(page),
      limit: Number(limit),
    };
  }

  /**
   * Get order by ID with RBAC ownership check.
   */
  async getOrderById(id: string, userId: string, role: Role) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { foodItem: true } },
        restaurant: true,
        driver: true,
        customer: true,
        reviews: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    // RBAC check
    if (role === Role.CUSTOMER && order.customerId !== userId) {
      throw new ForbiddenException('Not your order');
    }
    if (role === Role.DRIVER) {
      const driverProfile = await this.prisma.driverProfile.findUnique({
        where: { userId },
      });
      if (!driverProfile || order.driverId !== driverProfile.id) {
        throw new ForbiddenException('Not your delivery');
      }
    }
    if (role === Role.VENDOR && order.restaurant.ownerId !== userId) {
      throw new ForbiddenException('Not your restaurant order');
    }

    return order;
  }

  /**
   * Get vendor's restaurant orders.
   */
  async getVendorOrders(
    restaurantId: string,
    vendorId: string,
    filters: { status?: OrderStatus; page?: number; limit?: number },
  ) {
    // Verify ownership
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
    });
    if (!restaurant || restaurant.ownerId !== vendorId) {
      throw new ForbiddenException('Not your restaurant');
    }

    const { status, page = 1, limit = 20 } = filters;
    const where: any = { restaurantId };
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { 
          items: { include: { foodItem: true } },
          customer: true
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data,
      total,
      page: Number(page),
      limit: Number(limit),
    };
  }

  /**
   * Update order status — validated via state machine.
   */
  async updateStatus(
    orderId: string,
    dto: UpdateOrderStatusDto,
    userId: string,
    role: Role,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');

    this.stateMachine.validateTransition(order.status, dto.status, role);

    // Build timestamp updates
    const timestamps: any = {};
    switch (dto.status) {
      case OrderStatus.CONFIRMED:
        timestamps.acceptedAt = new Date();
        // Trigger driver assignment as soon as vendor confirms
        this.assignDriversToOrder(orderId).catch(err => 
          this.logger.error(`Failed to assign drivers to order ${orderId}`, err.stack)
        );
        break;
      case OrderStatus.PREPARING:
        timestamps.preparingAt = new Date();
        break;
      case OrderStatus.READY:
        timestamps.readyAt = new Date();
        break;
      case OrderStatus.DELIVERED:
        timestamps.deliveredAt = new Date();
        break;
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: dto.status,
        ...timestamps,
      },
      include: { items: true, restaurant: true },
    });

    // Side effects: Notify Customer
    await this.notifications.notifyCustomer(updated.customerId, dto.status, orderId);
    this.gateway.emitToCustomer(updated.customerId, 'order:status_changed', updated);
    this.gateway.emitToOrder(orderId, 'status_changed', { status: dto.status });

    // Side effects: DELIVERED → add earnings
    if (dto.status === OrderStatus.DELIVERED) {
      await this.handleDelivered(updated);
    }

    return updated;
  }

  /**
   * Cancel an order (CUSTOMER).
   */
  async cancelOrder(orderId: string, customerId: string, reason?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.customerId !== customerId) {
      throw new ForbiddenException('Not your order');
    }

    // Can only cancel before PREPARING
    const cancellable: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.CONFIRMED];
    if (!cancellable.includes(order.status)) {
      throw new BadRequestException(
        'Order cannot be cancelled at this stage',
      );
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CANCELLED },
    });

    // If already paid, initiate refund
    if (order.paymentState === PaymentState.PAID) {
      await this.prisma.user.update({
        where: { id: customerId },
        data: { walletBalance: { increment: order.total } },
      });
      await this.prisma.order.update({
        where: { id: orderId },
        data: { paymentState: PaymentState.REFUNDED },
      });
      await this.prisma.ledger.create({
        data: {
          userId: customerId,
          orderId,
          type: 'REFUND',
          amount: order.total,
          signature: SignatureUtil.signLedgerEntry({
            userId: customerId,
            orderId,
            type: 'REFUND',
            amount: order.total,
          }),
        },
      });
    }

    return updated;
  }

  /**
   * Create a dispute for an order.
   */
  async createDispute(
    orderId: string,
    customerId: string,
    data: { reason: string; details?: string },
  ) {
    return this.disputesService.create(customerId, {
      orderId,
      reason: data.reason,
      details: data.details,
    });
  }

  /**
   * Find and notify nearby drivers about a new ready order.
   */
  async assignDriversToOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { restaurant: true, items: true },
    });
    if (!order) return;

    const orderVolume = order.items.reduce((acc: number, item: any) => acc + item.quantity, 0);

    const drivers = await this.driversService.findNearbyDrivers(
      order.restaurant.latitude || 0,
      order.restaurant.longitude || 0,
      5, // 5km radius
      orderVolume,
    );

    if (drivers.length === 0) {
      this.logger.warn(`No nearby drivers found for order ${orderId}`);
      return;
    }

    // Create delivery requests
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min expiration
    await Promise.all(
      drivers.map((driver) =>
        this.prisma.deliveryRequest.create({
          data: {
            orderId,
            driverId: driver.id,
            expiresAt,
            deliveryFee: order.deliveryFee,
          },
        }),
      ),
    );

    // Notify drivers
    const driverUserIds = drivers.map((d) => d.userId);
    await this.notifications.notifyAvailableDrivers(driverUserIds, orderId);
    
    for (const driver of drivers) {
      this.gateway.emitToDriver(driver.id, 'order:new_request', {
        orderId,
        expiresAt,
      });
    }

    this.logger.log(`Delivery requests sent to ${drivers.length} drivers for order ${orderId}`);
  }

  /**
   * Get Flex Token for frontend payment form.
   */
  async getFlexToken() {
    return this.paymentsService.getFlexCaptureContext();
  }

  /**
   * Handle CyberSource payment callback (webhook).
   */
  async handlePaymentCallback(body: any, signature: string) {
    const isValid = this.paymentsService.verifyWebhookSignature(body, signature);
    if (!isValid) throw new ForbiddenException('Invalid signature');

    const orderId = body.clientReferenceInformation?.code;
    const status = body.status;

    if (status === 'AUTHORIZED' || status === 'CAPTURED') {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { paymentState: PaymentState.PAID },
      });
      
      const order = await this.prisma.order.findUnique({ where: { id: orderId } });
      if (order) {
        await this.notifications.notifyVendor(order.restaurantId, order.id);
        this.gateway.emitToVendor(order.restaurantId, 'order:new', order);
      }
    } else {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { paymentState: PaymentState.FAILED },
      });
    }

    return { received: true };
  }

  private async handleDelivered(order: any) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: order.restaurantId },
    });
    const config = await this.prisma.systemConfig.findUnique({
      where: { id: 'default' },
    });

    // 1. Calculate Split Logic (New: Restaurant gets 100% of products)
    const restaurantShare = order.subtotal;
    const appCommission = 0; // No commission from products, only service fee
    
    const driverShare = order.deliveryFee + (order.driverBoost || 0) + (order.tips || 0);
    const appShare = order.serviceFee;

    // 2. Determine Inflow (Online vs CASH)
    const isCash = order.paymentMethod === 'CASH';
    const cashCollected = isCash ? order.total : 0;

    // Save final split to order
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        appCommission,
        restaurantShare,
        driverShare,
        appShare,
        cashCollected,
      }
    });

    // 3. Restaurant Settlement (Pending Balance)
    if (restaurant) {
      await this.prisma.restaurant.update({
        where: { id: order.restaurantId },
        data: {
          pendingBalance: { increment: restaurantShare },
          totalEarnings: { increment: restaurantShare },
        },
      });

      // Log earning as pending for the restaurant owner
      await this.prisma.ledger.create({
        data: {
          userId: restaurant.ownerId,
          orderId: order.id,
          type: 'EARNING',
          amount: restaurantShare,
          status: 'pending', // Marks that it's waiting for Payout Cycle
          signature: SignatureUtil.signLedgerEntry({
            userId: restaurant.ownerId,
            orderId: order.id,
            type: 'EARNING',
            amount: restaurantShare,
          }),
        },
      });
    }

    // 4. Driver Wallet & Debt Logic
    if (order.driverId) {
      const driver = await this.prisma.driverProfile.findUnique({
        where: { id: order.driverId },
      });
      
      if (driver) {
        if (isCash) {
          // Debt Logic: Driver collected the full cash but only owns their share.
          const debtIncrease = cashCollected - driverShare;
          const newDebtBalance = driver.debtBalance + debtIncrease;
          const debtLimit = config?.driverDebtLimit ?? 1000;
          
          await this.prisma.driverProfile.update({
            where: { id: driver.id },
            data: {
              debtBalance: newDebtBalance,
              totalEarnings: { increment: driverShare },
              totalTrips: { increment: 1 },
              // Suspend driver if debt exceeds limit
              isAvailable: newDebtBalance >= debtLimit ? false : driver.isAvailable,
            },
          });
          
          if (newDebtBalance >= debtLimit) {
            this.logger.warn(`Driver ${driver.id} suspended due to exceeding debt limit.`);
          }
          
          // Log earning in ledger
          await this.prisma.ledger.create({
            data: {
              userId: driver.userId,
              orderId: order.id,
              type: 'EARNING',
              amount: driverShare,
              signature: SignatureUtil.signLedgerEntry({
                userId: driver.userId,
                orderId: order.id,
                type: 'EARNING',
                amount: driverShare,
              }),
            },
          });
          
        } else {
          // Online Payment: Driver gets their share sent to their wallet
          await this.prisma.user.update({
            where: { id: driver.userId },
            data: { walletBalance: { increment: driverShare } },
          });
          
          await this.prisma.driverProfile.update({
            where: { id: driver.id },
            data: {
              totalEarnings: { increment: driverShare },
              totalTrips: { increment: 1 },
            },
          });
          
          await this.prisma.ledger.create({
            data: {
              userId: driver.userId,
              orderId: order.id,
              type: 'EARNING',
              amount: driverShare,
              signature: SignatureUtil.signLedgerEntry({
                userId: driver.userId,
                orderId: order.id,
                type: 'EARNING',
                amount: driverShare,
              }),
            },
          });
        }
      }
    }

    // 5. Loyalty Points
    const loyaltyRate = config?.loyaltyPointsPerEGP ?? 1.0;
    const pointsEarned = Math.floor(order.total * loyaltyRate);
    if (pointsEarned > 0) {
      await this.loyaltyService.addPoints(order.customerId, pointsEarned);
    }

    this.logger.log(`Order ${order.id} delivered — Financial split completed and Driver Debt updated.`);
  }

  private getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  async getTrackingInfo(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        driver: { include: { user: { select: { name: true, phone: true } } } },
        restaurant: {
          select: {
            name: true,
            latitude: true,
            longitude: true,
            address: true,
          },
        },
      },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.customerId !== userId)
      throw new ForbiddenException('Not your order');

    // Only orders that are assigned to a driver can be tracked in detail
    if (!order.driverId || !order.driver) {
      return {
        orderId: order.id,
        status: order.status,
        message: 'No driver assigned yet',
        restaurant: {
          name: order.restaurant.name,
          lat: order.restaurant.latitude,
          lng: order.restaurant.longitude,
          address: order.restaurant.address,
        },
        destination: {
          lat: order.deliveryLat,
          lng: order.deliveryLng,
          address: order.deliveryAddress,
        },
      };
    }

    const driver = order.driver;

    return {
      orderId: order.id,
      status: order.status,
      driver: {
        id: driver.id,
        name: driver.user.name,
        phone: driver.user.phone,
        lat: driver.currentLat,
        lng: driver.currentLng,
        lastPing: driver.lastPingAt,
      },
      destination: {
        lat: order.deliveryLat,
        lng: order.deliveryLng,
        address: order.deliveryAddress,
      },
      restaurant: {
        name: order.restaurant.name,
        lat: order.restaurant.latitude,
        lng: order.restaurant.longitude,
        address: order.restaurant.address,
      },
    };
  }

  private calculateDeliveryFee(restaurant: any, distance: number): number {
    const mode = restaurant.deliveryFeeMode; // 'fixed' or 'distance'
    const formula = restaurant.deliveryFeeFormula as any; // sub_mode: 'per_km' or 'tiered'

    // Default system fee if no restaurant config
    const defaultFee = Math.max(15, Math.round(distance * 4 * 100) / 100);

    if (mode === 'fixed') {
      return restaurant.deliveryFee || 15;
    }

    if (mode === 'distance') {
      if (formula?.sub_mode === 'per_km') {
        const base = formula.base_fee || 0;
        const rate = formula.per_km_rate || 0;
        return Math.round((base + distance * rate) * 100) / 100;
      }

      if (formula?.sub_mode === 'tiered' && Array.isArray(formula.tiers)) {
        const matchingTier = formula.tiers.find(
          (t: any) => distance >= t.from && distance < t.to,
        );
        if (matchingTier) {
          return matchingTier.price;
        }
        // If outside tiers but inside radius, use last tier or default
        const lastTier = formula.tiers[formula.tiers.length - 1];
        if (lastTier && distance >= lastTier.from) return lastTier.price;
      }
    }

    return defaultFee;
  }
}
