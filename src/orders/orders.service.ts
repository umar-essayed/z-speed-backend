import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, PaymentState, AccountStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStateMachineService } from './order-state-machine.service';
import { RealtimeGateway } from '../gateway/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { CalculateOrderDto, CheckoutDto, UpdateOrderStatusDto } from './dto';

import { PromotionsService } from '../promotions/promotions.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { DisputesService } from '../disputes/disputes.service';
import { PaymentsService } from '../payments/payments.service';
import { DriversService } from '../drivers/drivers.service';
import { SignatureUtil } from '../wallet/signature.util';
import { FirebaseSyncService } from './firebase-sync.service';
import { forwardRef, Inject } from '@nestjs/common';

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
    @Inject(forwardRef(() => FirebaseSyncService))
    private readonly firebaseSync: FirebaseSyncService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Calculate order totals without creating an order.
   */
  async calculate(customerId: string, dto: CalculateOrderDto) {
    const { subtotal, deliveryFee, serviceFee, discount, total, items, restaurant, address, distance } = 
      await this._getCalculation(customerId, dto);
    
    return {
      subtotal,
      deliveryFee,
      serviceFee,
      discount,
      total,
      distance,
      itemsCount: items.length,
      restaurantName: restaurant.name,
      deliveryAddress: `${address.street}, ${address.city}`,
    };
  }

  private async _getCalculation(customerId: string, dto: CalculateOrderDto | CheckoutDto) {
    // 1. Validate cart is not empty
    const cart = await this.prisma.cart.findUnique({
      where: { customerId },
      include: { items: { include: { foodItem: true } } },
    });
    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
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
      
      const enforceGeofence = this.configService.get<string>('ENFORCE_DELIVERY_GEOFENCE') !== 'false';
      const radius = restaurant.deliveryRadiusKm || 10.0;
      
      if (enforceGeofence && distance > radius) {
        throw new BadRequestException('Delivery address is outside the restaurant delivery zone');
      }
    }

    // 4. Calculate totals
    const rawSubtotal = cart.items.reduce(
      (sum, item) => sum + (item.foodItem?.price ?? item.unitPrice) * item.quantity,
      0,
    );
    const subtotal = Math.round(rawSubtotal * 100) / 100;
    
    // Check minimum order
    if (restaurant.minimumOrder && subtotal < restaurant.minimumOrder) {
      throw new BadRequestException(`Minimum order amount for this restaurant is ${restaurant.minimumOrder} EGP`);
    }

    // Calculate Delivery Fee based on restaurant settings
    const deliveryFee = this.calculateDeliveryFee(restaurant, distance);

    // 4.5 Calculate Service Fee — always load system config as fallback
    const sysConfig = await this.prisma.systemConfig.findUnique({ where: { id: 'default' } });
    const fallbackFeePercent = sysConfig?.platformFeePercent ?? 2.0;
    let serviceFee = 0;
    const r = restaurant as any;
    if (r.serviceFeeType === 'fixed' && r.serviceFeeValue != null) {
      serviceFee = r.serviceFeeValue;
    } else if (r.serviceFeeType === 'percentage' && r.serviceFeeValue != null) {
      serviceFee = Math.round(subtotal * (r.serviceFeeValue / 100) * 100) / 100;
    } else {
      // Fallback to system config (covers missing type OR missing value)
      serviceFee = Math.round(subtotal * (fallbackFeePercent / 100) * 100) / 100;
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
    
    this.logger.log(`[OrderCalc] Customer: ${customerId}, Subtotal: ${subtotal}, Distance: ${distance}, DeliveryFee: ${deliveryFee}, ServiceFee: ${serviceFee}, Total: ${total}`);

    return {
      subtotal,
      deliveryFee,
      serviceFee,
      discount,
      total,
      promoId,
      items: cart.items,
      cartId: cart.id,
      restaurant,
      address,
      distance,
      commissionRate: restaurant.commissionRate || 0.02,
    };
  }

  /**
   * Checkout: convert cart to order.
   */
  async checkout(customerId: string, dto: CheckoutDto) {
    const calc = await this._getCalculation(customerId, dto);
    const { subtotal, deliveryFee, serviceFee, discount, total, promoId, items, cartId, restaurant, address } = calc;

    // Pre-validate before entering transaction
    if (dto.paymentMethod === 'CYBERSOURCE_CARD' && !dto.transientToken) {
      throw new BadRequestException('Transient token required for card payments');
    }

    // Execute all DB writes atomically to prevent partial state on failure
    let paymentState: PaymentState = PaymentState.PENDING;
    const order = await this.prisma.$transaction(async (tx) => {
      // 6. Handle payment method inside transaction
      if (dto.paymentMethod === 'WALLET') {
        const user = await tx.user.findUnique({ where: { id: customerId } });
        if (!user || user.walletBalance < total) {
          throw new BadRequestException('Insufficient wallet balance');
        }
        await tx.user.update({
          where: { id: customerId },
          data: { walletBalance: { decrement: total } },
        });
        paymentState = PaymentState.PAID;
      }

      // 7. Create order — use live foodItem.price to ensure consistency with subtotal
      const newOrder = await tx.order.create({
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
            create: items.map((item) => ({
              foodItem: { connect: { id: item.foodItemId } },
              quantity: item.quantity,
              unitPrice: item.foodItem?.price ?? item.unitPrice, // Fixed: use live DB price
              selectedAddons: item.selectedAddons ?? undefined,
              specialNote: item.specialNote ?? undefined,
            })),
          },
        },
        include: {
          items: { include: { foodItem: true } },
          restaurant: { select: { ownerId: true } },
        },
      });

      // 8. Record promo usage inside transaction so it rolls back if order fails
      if (dto.promoCode && promoId) {
        await tx.promotionUsage.create({
          data: {
            promotionId: promoId,
            userId: customerId,
            orderId: newOrder.id,
          },
        });
      }

      // 9. Clear cart
      await tx.cartItem.deleteMany({ where: { cartId: cartId } });
      await tx.cart.update({
        where: { id: cartId },
        data: { restaurantId: null },
      });

      return newOrder;
    });

    // Increment promo counter outside transaction (best-effort, non-critical)
    if (dto.promoCode && promoId) {
      this.promotionsService.incrementUsage(dto.promoCode).catch(err =>
        this.logger.warn(`Failed to increment promo usage for ${dto.promoCode}: ${err.message}`)
      );
    }

    this.logger.log(`Order created: ${order.id} by customer ${customerId} for restaurant ${dto.restaurantId}`);

    // Notify Vendor
    try {
      await this.notifications.notifyVendor(dto.restaurantId, order.id);
    } catch (err) {
      this.logger.error(`Failed to notify vendor for order ${order.id}:`, err.stack);
    }
    try {
      this.gateway.emitToVendor(dto.restaurantId, 'order:new', order);
    } catch (err) {
      this.logger.error(`Failed to emit to vendor via gateway:`, err.stack);
    }

    // 10. If card, initiate payment
    if (dto.paymentMethod === 'CYBERSOURCE_CARD' && dto.transientToken) {
      const paymentResult = await this.paymentsService.initiateFlexPayment(order.id, dto.transientToken);
      if (!paymentResult.success) {
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
   * Public method so FirebaseSyncService can award loyalty points
   * without directly coupling to LoyaltyService.
   */
  async awardLoyaltyPointsForOrder(customerId: string, points: number) {
    if (points > 0) {
      await this.loyaltyService.addPoints(customerId, points);
    }
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

    let customerDistance = null;
    if (order.restaurant.latitude && order.restaurant.longitude && order.deliveryLat && order.deliveryLng) {
      customerDistance = this.getDistance(
        order.restaurant.latitude,
        order.restaurant.longitude,
        order.deliveryLat,
        order.deliveryLng
      );
    }

    let driverToCustomerDistance = null;
    if (order.driver && order.driver.currentLat && order.driver.currentLng && order.deliveryLat && order.deliveryLng) {
      driverToCustomerDistance = this.getDistance(
        order.driver.currentLat,
        order.driver.currentLng,
        order.deliveryLat,
        order.deliveryLng
      );
    }

    return {
      ...order,
      customerDistance,
      driverToCustomerDistance,
      estimatedDeliveryTime: customerDistance ? Math.round((customerDistance / 20) * 60 + 15) : null
    };
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
          restaurant: true,
          items: { include: { foodItem: true } },
          customer: true,
          driver: { include: { user: { select: { name: true, phone: true } } } },
          deliveryRequests: {
            include: {
              driver: {
                include: { user: { select: { name: true, phone: true, profileImage: true } } }
              }
            }
          }
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    const mappedData = data.map(order => {
      let customerDistance = null;
      if (order.restaurant.latitude && order.restaurant.longitude && order.deliveryLat && order.deliveryLng) {
        customerDistance = this.getDistance(
          order.restaurant.latitude,
          order.restaurant.longitude,
          order.deliveryLat,
          order.deliveryLng
        );
      }
      
      let driverToCustomerDistance = null;
      if (order.driver && order.driver.currentLat && order.driver.currentLng && order.deliveryLat && order.deliveryLng) {
        driverToCustomerDistance = this.getDistance(
          order.driver.currentLat,
          order.driver.currentLng,
          order.deliveryLat,
          order.deliveryLng
        );
      }
      
      return {
        ...order,
        customerDistance,
        driverToCustomerDistance,
        estimatedDeliveryTime: customerDistance ? Math.round((customerDistance / 20) * 60 + 15) : null
      };
    });

    return {
      data: mappedData,
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
        // Trigger driver assignment disabled temporarily for manual selection
        /*
        this.assignDriversToOrder(orderId).catch(err => 
          this.logger.error(`Failed to assign drivers to order ${orderId}`, err.stack)
        );
        */
        break;
      case OrderStatus.PREPARING:
        timestamps.preparingAt = new Date();
        break;
      case OrderStatus.READY:
        timestamps.readyAt = new Date();
        break;
      case OrderStatus.PICKED_UP:
        timestamps.pickedUpAt = new Date();
        break;
      case OrderStatus.OUT_FOR_DELIVERY:
      case OrderStatus.IN_TRANSIT:
        timestamps.outForDeliveryAt = new Date();
        break;
      case OrderStatus.ARRIVED:
        timestamps.arrivedAt = new Date();
        break;
      case OrderStatus.DELIVERED:
        timestamps.deliveredAt = new Date();
        break;
    }

    // 1. Update PostgreSQL Database FIRST — source of truth
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: dto.status,
        ...timestamps,
      },
      include: { items: true, restaurant: true },
    });

    // 2. THEN sync to Firebase (Async — don't block response)
    this.firebaseSync.updateFirebaseOrderStatus(orderId, dto.status).catch(err =>
      this.logger.error(`Failed to sync status to Firebase for order ${orderId}:`, err.stack)
    );

    // 3. Side effects: Notify Customer (Backgrounded)
    this.notifications.notifyCustomer(updated.customerId, dto.status, orderId).catch(err => 
      this.logger.error(`Failed to notify customer for order ${orderId}:`, err.stack)
    );
    this.gateway.emitToCustomer(updated.customerId, 'order:status_changed', updated);
    this.gateway.emitToOrder(orderId, 'status_changed', { status: dto.status });

    // Side effects: DELIVERED → add earnings (Async, don't wait)
    if (dto.status === OrderStatus.DELIVERED) {
      this.handleDelivered(updated).catch(err => 
        this.logger.error(`Financial settlement failed for order ${orderId}:`, err.stack)
      );
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
      include: { restaurant: true, items: true, customer: true },
    });
    if (!order) return;

    const orderVolume = order.items.reduce((acc: number, item: any) => acc + item.quantity, 0);

    const enforceGeofence = this.configService.get<string>('ENFORCE_DELIVERY_GEOFENCE') !== 'false';
    const searchRadius = enforceGeofence ? 30 : 5000;

    const drivers = await this.driversService.findNearbyDrivers(
      order.restaurant.latitude || 0,
      order.restaurant.longitude || 0,
      searchRadius,
      orderVolume,
    );

    if (drivers.length === 0) {
      this.logger.warn(`No nearby drivers found for order ${orderId}`);
      return;
    }

    // Create delivery requests
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min expiration
    await Promise.all(
      drivers.map(({ driver, distance }) =>
        this.prisma.deliveryRequest.create({
          data: {
            orderId,
            driverId: driver.id,
            expiresAt,
            deliveryFee: order.deliveryFee,
            estimatedDistance: distance,
          },
        }).then((req) => {
          // Sync to Firebase for the driver app (Backgrounded to avoid timeout)
          this.firebaseSync.createDeliveryRequestInFirebase(driver.id, orderId, {
            firebaseOrderId: order.firebaseOrderId,
            deliveryFee: order.deliveryFee,
            estimatedDistance: distance,
            expiresAt,
            restaurantName: order.restaurant.name,
            restaurantLogoUrl: order.restaurant.logoUrl,
            deliveryAddress: order.deliveryAddress,
            customerName: order.customer?.name || 'Customer',
            orderTotal: order.total,
            paymentMethod: order.paymentMethod,
          }).catch(err => 
            this.logger.error(`Failed to sync delivery request to Firebase for driver ${driver.id}:`, err.stack)
          );
          return req;
        })
      ),
    );

    // Notify drivers (Backgrounded)
    const driverUserIds = drivers.map(({ driver }) => driver.userId);
    this.notifications.notifyAvailableDrivers(driverUserIds, orderId).catch(err => 
      this.logger.error(`Failed to notify drivers for order ${orderId}:`, err.stack)
    );
    
    for (const { driver } of drivers) {
      this.gateway.emitToDriver(driver.id, 'order:new_request', {
        orderId,
        expiresAt,
      });
    }

    this.logger.log(`Delivery requests sent to ${drivers.length} drivers for order ${orderId}`);
  }

  /**
   * Get drivers eligible for this specific order, sorted by proximity.
   */
  async getEligibleDrivers(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { restaurant: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const lat = order.restaurant.latitude || 0;
    const lng = order.restaurant.longitude || 0;

    const enforceGeofence = this.configService.get<string>('ENFORCE_DELIVERY_GEOFENCE') !== 'false';
    const searchRadius = enforceGeofence ? 30 : 5000;

    // Use radius 30km for eligibility
    const nearby = await this.driversService.getAvailableDrivers(lat, lng, searchRadius);
    
    // De-duplicate by userId to avoid multiple profiles for same person
    const uniqueDriversMap = new Map();
    nearby.forEach(d => {
      const uId = d.user?.id || d.id;
      if (!uniqueDriversMap.has(uId)) {
        uniqueDriversMap.set(uId, d);
      }
    });

    const uniqueNearby = Array.from(uniqueDriversMap.values());
    
    // Sort by distance ASC
    return uniqueNearby.sort((a, b) => (a.distance || 999) - (b.distance || 999)).map(d => {
       // Estimate time: distance / avg speed (20 km/h) + buffer
       const estimatedTimeMin = d.distance ? Math.round((d.distance / 20) * 60 + 5) : null;
       return {
         ...d,
         estimatedTimeMin
       };
    });
  }

  /**
   * Send a delivery request to a specific driver.
   */
  async requestDriver(orderId: string, driverId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { restaurant: true, customer: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: driverId },
      include: { user: true }
    });
    if (!driver) throw new NotFoundException('Driver not found');

    // Create delivery request
    const distance = (order.restaurant.latitude && order.restaurant.longitude && driver.currentLat && driver.currentLng)
      ? this.driversService.calculateDistance(order.restaurant.latitude, order.restaurant.longitude, driver.currentLat, driver.currentLng)
      : 0;

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min expiration
    
    const request = await this.prisma.deliveryRequest.create({
      data: {
        orderId,
        driverId,
        expiresAt,
        deliveryFee: order.deliveryFee,
        estimatedDistance: distance,
      },
    });

    // Sync to Firebase (Backgrounded to avoid 524 timeout)
    this.firebaseSync.createDeliveryRequestInFirebase(driverId, orderId, {
      firebaseOrderId: order.firebaseOrderId,
      deliveryFee: order.deliveryFee,
      estimatedDistance: distance,
      expiresAt,
      restaurantName: order.restaurant.name,
      restaurantLogoUrl: order.restaurant.logoUrl,
      deliveryAddress: order.deliveryAddress,
      customerName: order.customer?.name || 'Customer',
      orderTotal: order.total,
      paymentMethod: order.paymentMethod,
    }).catch(err => 
      this.logger.error(`Failed to sync manual driver request to Firebase: ${err.message}`)
    );

    // Notify driver (Backgrounded)
    this.notifications.notifyAvailableDrivers([driver.userId], orderId).catch(err => 
      this.logger.error(`Failed to notify specific driver: ${err.message}`)
    );
    this.gateway.emitToDriver(driverId, 'order:new_request', { orderId, expiresAt });

    return request;
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
    // Idempotency guard: skip if this order was already settled
    const existingSettlement = await this.prisma.ledger.findFirst({
      where: { orderId: order.id, type: 'EARNING' },
    });
    if (existingSettlement) {
      this.logger.warn(`Order ${order.id} already financially settled. Skipping duplicate settlement.`);
      return;
    }

    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: order.restaurantId },
    });
    const config = await this.prisma.systemConfig.findUnique({
      where: { id: 'default' },
    });

    // 1. Unified split: Restaurant = subtotal (100%), App = serviceFee only
    const restaurantShare = order.subtotal;
    const appCommission = 0; // Commission taken via serviceFee, not from restaurant subtotal
    
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

          // Log DEBT in ledger (Cash collected minus driver share)
          await this.prisma.ledger.create({
            data: {
              userId: driver.userId,
              orderId: order.id,
              type: 'DEBT',
              amount: debtIncrease,
              signature: SignatureUtil.signLedgerEntry({
                userId: driver.userId,
                orderId: order.id,
                type: 'DEBT',
                amount: debtIncrease,
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
