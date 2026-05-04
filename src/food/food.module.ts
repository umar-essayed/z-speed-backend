import { Module } from '@nestjs/common';
import { FoodController, PublicFoodController } from './food.controller';
import { FoodService } from './food.service';

@Module({
  controllers: [FoodController, PublicFoodController],
  providers: [FoodService],
  exports: [FoodService],
})
export class FoodModule {}
