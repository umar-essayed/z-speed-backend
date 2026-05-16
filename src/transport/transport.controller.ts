import { Controller, Get, Post, Body, Patch, Param, UseGuards } from '@nestjs/common';
import { TransportService } from './transport.service';
import { CreateRideDto } from './dto/create-ride.dto';
import { RideStatus } from '@prisma/client';

@Controller('transport')
export class TransportController {
  constructor(private readonly transportService: TransportService) {}

  @Post()
  create(@Body() createRideDto: CreateRideDto) {
    return this.transportService.createRide(createRideDto);
  }

  @Get()
  findAll() {
    return this.transportService.findAll();
  }

  @Get('stats')
  getStats() {
    return this.transportService.getStats();
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
