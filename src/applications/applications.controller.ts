import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import { SuperTokensAuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('applications')
@UseGuards(SuperTokensAuthGuard)
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Get()
  async getApplications(
    @CurrentUser('userId') currentUserId: string,
    @Query('userId') userId?: string,
  ) {
    const targetId = userId || currentUserId;
    return this.applicationsService.getByUserId(targetId);
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.applicationsService.getById(id);
  }
}
