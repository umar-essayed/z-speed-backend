import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddCartItemDto, UpdateCartItemDto } from './dto';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get or create the customer's cart with items.
   */
  async getCart(customerId: string) {
    let cart = await this.prisma.cart.findUnique({
      where: { customerId },
      include: {
        items: {
          include: { foodItem: true },
          orderBy: { addedAt: 'desc' },
        },
      },
    });

    if (!cart) {
      cart = await this.prisma.cart.create({
        data: { customerId },
        include: {
          items: {
            include: { foodItem: true },
            orderBy: { addedAt: 'desc' },
          },
        },
      });
    }

    const totals = this.calculateTotals(cart.items);

    return { ...cart, ...totals };
  }

  /**
   * Add an item to the cart. Enforces single-restaurant cart rule.
   */
  async addItem(customerId: string, dto: AddCartItemDto) {
    const itemId = dto.foodItemId || dto.menuItemId;
    if (!itemId) {
      throw new ConflictException('foodItemId or menuItemId must be provided');
    }

    // Get the food item and its restaurant
    const foodItem = await this.prisma.foodItem.findUnique({
      where: { id: itemId },
      include: { section: true },
    });
    if (!foodItem) throw new NotFoundException('Food item not found');

    if (!foodItem.isAvailable) {
      throw new ConflictException('This item is currently unavailable');
    }

    const restaurantId = foodItem.section.restaurantId;

    // Get or create cart
    let cart = await this.prisma.cart.findUnique({
      where: { customerId },
      include: { items: true },
    });

    if (!cart) {
      cart = await this.prisma.cart.create({
        data: { customerId, restaurantId },
        include: { items: true },
      });
    }

    // Check if cart has items from a different restaurant
    if (cart.restaurantId && cart.restaurantId !== restaurantId && cart.items.length > 0) {
      throw new ConflictException(
        'Your cart contains items from a different restaurant. Please clear your cart first.',
      );
    }

    // Update restaurant ID if cart was empty
    if (!cart.restaurantId || cart.items.length === 0) {
      await this.prisma.cart.update({
        where: { id: cart.id },
        data: { restaurantId },
      });
    }

    // Check if item already exists in cart — update quantity if so
    const existingItem = cart.items.find(
      (item) => item.foodItemId === itemId,
    );

    if (existingItem) {
      return this.prisma.cartItem.update({
        where: { id: existingItem.id },
        data: {
          quantity: existingItem.quantity + dto.quantity,
          selectedAddons: dto.selectedAddons ?? existingItem.selectedAddons,
          specialNote: dto.specialNote ?? existingItem.specialNote,
        },
        include: { foodItem: true },
      });
    }

    return this.prisma.cartItem.create({
      data: {
        cartId: cart.id,
        foodItemId: itemId,

        quantity: dto.quantity,
        unitPrice: foodItem.price,
        selectedAddons: dto.selectedAddons,
        specialNote: dto.specialNote,
      },
      include: { foodItem: true },
    });
  }

  /**
   * Update a cart item (quantity, addons).
   */
  async updateItem(
    customerId: string,
    itemId: string,
    dto: UpdateCartItemDto,
  ) {
    const cart = await this.prisma.cart.findUnique({
      where: { customerId },
    });
    if (!cart) throw new NotFoundException('Cart not found');

    const cartItem = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
    });
    if (!cartItem) throw new NotFoundException('Cart item not found');

    return this.prisma.cartItem.update({
      where: { id: itemId },
      data: {
        quantity: dto.quantity,
        selectedAddons: dto.selectedAddons,
      },
      include: { foodItem: true },
    });
  }

  async incrementItem(customerId: string, itemId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { customerId },
    });
    if (!cart) throw new NotFoundException('Cart not found');

    const cartItem = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
    });
    if (!cartItem) throw new NotFoundException('Cart item not found');

    return this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity: { increment: 1 } },
      include: { foodItem: true },
    });
  }

  async decrementItem(customerId: string, itemId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { customerId },
    });
    if (!cart) throw new NotFoundException('Cart not found');

    const cartItem = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
    });
    if (!cartItem) throw new NotFoundException('Cart item not found');

    if (cartItem.quantity <= 1) {
      return this.removeItem(customerId, itemId);
    }

    return this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity: { decrement: 1 } },
      include: { foodItem: true },
    });
  }


  /**
   * Remove a single item from the cart.
   */
  async removeItem(customerId: string, itemId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { customerId },
    });
    if (!cart) throw new NotFoundException('Cart not found');

    const cartItem = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
    });
    if (!cartItem) throw new NotFoundException('Cart item not found');

    await this.prisma.cartItem.delete({ where: { id: itemId } });

    // If cart is now empty, clear restaurant reference
    const remainingItems = await this.prisma.cartItem.count({
      where: { cartId: cart.id },
    });
    if (remainingItems === 0) {
      await this.prisma.cart.update({
        where: { id: cart.id },
        data: { restaurantId: null },
      });
    }

    return { message: 'Item removed from cart' };
  }

  /**
   * Clear all items from the cart.
   */
  async clearCart(customerId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { customerId },
    });
    if (!cart) return { message: 'Cart already empty' };

    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await this.prisma.cart.update({
      where: { id: cart.id },
      data: { restaurantId: null },
    });

    return { message: 'Cart cleared' };
  }

  /**
   * Calculate cart totals.
   */
  private calculateTotals(items: any[]) {
    const subtotal = items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    };
  }
}
