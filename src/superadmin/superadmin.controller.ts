import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApprovalStatus, Role } from '@prisma/client';
import { SuperadminService } from './superadmin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseUUIDPipe } from '../common/pipes/parse-uuid.pipe';

@Controller('superadmin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
export class SuperadminController {
  constructor(private readonly superadminService: SuperadminService) {}

  // =============================================
  // PENDING APPROVALS
  // =============================================

  @Get('approvals')
  async listApprovals(
    @Query('status') status?: ApprovalStatus,
    @Query('actionType') actionType?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.superadminService.listPendingApprovals({ status, actionType, page, limit });
  }

  @Get('approvals/:id')
  async getApprovalDetails(@Param('id', ParseUUIDPipe) id: string) {
    return this.superadminService.getApprovalDetails(id);
  }

  @Patch('approvals/:id/approve')
  async executeApproval(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') superadminId: string,
  ) {
    return this.superadminService.executeApproval(id, superadminId);
  }

  @Patch('approvals/:id/reject')
  async rejectApproval(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') superadminId: string,
    @Body('reason') reason: string,
  ) {
    return this.superadminService.rejectApproval(id, superadminId, reason);
  }

  // =============================================
  // ADMIN MANAGEMENT
  // =============================================

  @Post('admins')
  async createAdmin(
    @Body() dto: { name: string; email: string; phone?: string },
  ) {
    return this.superadminService.createAdmin(dto);
  }

  @Delete('admins/:id')
  async deleteAdmin(@Param('id', ParseUUIDPipe) id: string) {
    return this.superadminService.deleteAdmin(id);
  }

  @Get('admins/:id/activity')
  async getAdminActivity(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.superadminService.getAdminActivity(id, page, limit);
  }

  // =============================================
  // SYSTEM CONFIG
  // =============================================

  @Get('config')
  async getSystemConfig() {
    return this.superadminService.getSystemConfig();
  }

  @Patch('config')
  async updateSystemConfig(@Body() dto: any) {
    return this.superadminService.updateSystemConfig(dto);
  }

  // =============================================
  // AUDIT LOG
  // =============================================

  @Get('audit-log')
  async getAuditLog(
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('targetTable') targetTable?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.superadminService.getAuditLog({ userId, action, targetTable, page, limit });
  }
}
