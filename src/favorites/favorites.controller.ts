import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  async getMyFavorites(@CurrentUser('userId') userId: string) {
    return this.favoritesService.getMyFavorites(userId);
  }

  @Post('toggle')
  async toggleFavorite(
    @CurrentUser('userId') userId: string,
    @Body() body: { restaurantId?: string; foodItemId?: string },
  ) {
    return this.favoritesService.toggleFavorite(userId, body);
  }
}
