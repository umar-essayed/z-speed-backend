import { Controller, Get, Post, Body, Patch, Param, UseGuards } from '@nestjs/common';
import { TransportService } from './transport.service';
import { CreateRideDto } from './dto/create-ride.dto';
import { RideStatus } from '@prisma/client';

@Controller('transport')
export class TransportController {
  constructor(private readonly transportService: TransportService) {}

  // ── Existing Pricing & Dashboard Routes ──────────────────────────────────────

  @Get('pricing')
  getPricing() {
    return this.transportService.getPricing();
  }

  @Post('pricing')
  updatePricing(@Body() pricing: any) {
    return this.transportService.updatePricing(pricing);
  }

  @Get('stats')
  getStats() {
    return this.transportService.getStats();
  }

  // ── Production Integrated Gateway Routes ──────────────────────────────────────

  @Post('create-ride')
  createRideGateway(@Body() rideData: any) {
    return this.transportService.createRideGateway(rideData);
  }

  @Get('ride/:id')
  getRideGateway(@Param('id') id: string) {
    return this.transportService.getRideGateway(id);
  }

  @Post('update-ride')
  updateRideGateway(@Body() body: { rideId: string; updates: any }) {
    return this.transportService.updateRideGateway(body.rideId, body.updates);
  }

  @Post('update-ride-location')
  updateRideLocationGateway(@Body() body: { rideId: string; lat: number; lng: number }) {
    return this.transportService.updateRideLocationGateway(body.rideId, body.lat, body.lng);
  }

  @Get('pending-rides')
  getPendingRidesGateway() {
    return this.transportService.getPendingRidesGateway();
  }

  @Get('my-rides/:customerId')
  getMyRidesGateway(@Param('customerId') customerId: string) {
    return this.transportService.getMyRidesGateway(customerId);
  }

  @Get('driver-rides/:driverId')
  getDriverRidesGateway(@Param('driverId') driverId: string) {
    return this.transportService.getDriverRidesGateway(driverId);
  }

  // ── Standard PostgreSQL DB Routes ──────────────────────────────────────────

  @Post()
  create(@Body() createRideDto: CreateRideDto) {
    return this.transportService.createRide(createRideDto);
  }

  @Get('all')
  findAll() {
    return this.transportService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.transportService.findOne(id);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: RideStatus,
    @Body('driverId') driverId?: string,
  ) {
    return this.transportService.updateStatus(id, status, driverId);
  }
}
