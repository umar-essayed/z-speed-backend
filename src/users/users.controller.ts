import {
  Controller,
  Get,
  Put,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { SuperTokensAuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe';
import { UpdateProfileDto, CreateAddressDto, UpdateAddressDto } from './dto';

@Controller('users')
@UseGuards(SuperTokensAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@CurrentUser('userId') userId: string) {
    return this.usersService.findById(userId);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser('userId') userId: string,
    @Body() body: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, body);
  }

  @Put('me')
  async updateMePut(
    @CurrentUser('userId') userId: string,
    @Body() body: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, body);
  }

  @Post('addresses')
  async addAddress(
    @CurrentUser('userId') userId: string,
    @Body() body: CreateAddressDto,
  ) {
    return this.usersService.addAddress(userId, body);
  }

  @Get('addresses')
  async getAddresses(@CurrentUser('userId') userId: string) {
    return this.usersService.getAddresses(userId);
  }

  @Patch('addresses/:id')
  async updateAddress(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) addressId: string,
    @Body() body: UpdateAddressDto,
  ) {
    return this.usersService.updateAddress(userId, addressId, body);
  }

  @Delete('addresses/:id')
  async deleteAddress(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) addressId: string,
  ) {
    return this.usersService.deleteAddress(userId, addressId);
  }

  @Patch('addresses/:id/default')
  async setDefaultAddress(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) addressId: string,
  ) {
    return this.usersService.setDefaultAddress(userId, addressId);
  }
}
