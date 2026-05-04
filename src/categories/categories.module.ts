import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController, CuisineTypesController } from './categories.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CategoriesController, CuisineTypesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
