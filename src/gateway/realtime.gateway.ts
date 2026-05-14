import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  cors: {
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim().replace(/\/$/, ''))
      : '*',
    credentials: true,
  },
  namespace: '/',
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * On client connect: authenticate via JWT and join role-based rooms.
   */
  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      client.data.userId = payload.sub;
      client.data.role = payload.role;

      // Join user-specific room
      client.join(`user:${payload.sub}`);

      // Join role-based rooms
      if (payload.role === 'ADMIN' || payload.role === 'SUPERADMIN') {
        client.join('admins');
      }
      if (payload.role === 'SUPERADMIN') {
        client.join('superadmin');
      }

      this.logger.log(`Client connected: ${payload.sub} (${payload.role})`);
    } catch (err) {
      this.logger.warn(`Connection rejected: invalid token`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    if (client.data?.userId) {
      this.logger.log(`Client disconnected: ${client.data.userId}`);
    }
  }

  /**
   * Driver sends location updates → broadcast to active order customer.
   */
  @SubscribeMessage('driver:location_update')
  handleDriverLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { lat: number; lng: number; orderId?: string },
  ) {
    const payload = {
      driverId: client.data.userId,
      lat: data.lat,
      lng: data.lng,
      orderId: data.orderId,
      timestamp: new Date(),
    };

    if (data.orderId) {
      // Broadcast to the customer tracking this specific order
      this.server.to(`order:${data.orderId}`).emit('driver:location', payload);
    }

    // Broadcast to admins for the Live Map
    this.server.to('admins').emit('admin:driver_location', payload);
  }

  /**
   * Join an order-specific room (for live tracking).
   */
  @SubscribeMessage('order:subscribe')
  handleOrderSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orderId: string },
  ) {
    client.join(`order:${data.orderId}`);
    this.logger.log(`${client.data.userId} subscribed to order:${data.orderId}`);
  }

  /**
   * Vendor joins their restaurant room.
   */
  @SubscribeMessage('vendor:subscribe')
  handleVendorSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { restaurantId: string },
  ) {
    const room = `vendor:${data.restaurantId}`;
    client.join(room);
    this.logger.log(`🔍 [SOCKET] User ${client.data.userId} subscribed to room: ${room}`);
    
    // Log all rooms for this client
    const rooms = Array.from(client.rooms);
    this.logger.log(`🔍 [SOCKET] User ${client.data.userId} current rooms: ${rooms.join(', ')}`);
  }

  // =============================================
  // EMIT HELPERS (called by other services)
  // =============================================

  emitToCustomer(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  emitToVendor(restaurantId: string, event: string, data: any) {
    const room = `vendor:${restaurantId}`;
    this.logger.log(`📡 [SOCKET] Emitting ${event} to room ${room}`);
    this.server.to(room).emit(event, data);
    
    // Redundant emission to the owner's personal room if possible
    // This is a safety net in case restaurant subscription failed
    if (data.restaurant?.ownerId) {
      this.logger.log(`📡 [SOCKET] Redundant emission to user:${data.restaurant.ownerId}`);
      this.server.to(`user:${data.restaurant.ownerId}`).emit(event, data);
    }
  }

  emitToDriver(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  emitToAdmins(event: string, data: any) {
    this.server.to('admins').emit(event, data);
  }

  emitToSuperAdmin(event: string, data: any) {
    this.server.to('superadmin').emit(event, data);
  }

  emitToOrder(orderId: string, event: string, data: any) {
    this.server.to(`order:${orderId}`).emit(event, data);
  }
}
