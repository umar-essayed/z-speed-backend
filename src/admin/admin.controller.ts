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
  HttpCode,
  HttpStatus,
  Response,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // =============================================
  // ANALYTICS / DASHBOARD
  // =============================================

  @Get('analytics')
  async getAnalytics() {
    return this.adminService.getDashboardAnalytics();
  }

  // =============================================
  // USERS
  // =============================================

  @Get('users')
  async getAllUsers(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getAllUsers({ page, limit, role, status, search });
  }

  @Get('users/:id')
  async getUserById(@Param('id') id: string) {
    return this.adminService.getUserById(id);
  }

  @Patch('users/:id/status')
  async updateUserStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    return this.adminService.updateUserStatus(id, status);
  }

  @Patch('users/:id/role')
  async updateUserRole(
    @Param('id') id: string,
    @Body('role') role: string,
    @CurrentUser() currentUser: any,
  ) {
    return this.adminService.updateUserRole(currentUser.userId, id, role);
  }

  @Patch('users/:id/reset-password')
  async resetUserPassword(@Param('id') id: string) {
    return this.adminService.resetUserPassword(id);
  }

  @Patch('me/name')
  async updateOwnName(
    @Body('name') name: string,
    @CurrentUser() currentUser: any,
  ) {
    return this.adminService.updateOwnName(currentUser.userId, name);
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.OK)
  async deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  // =============================================
  // DRIVERS
  // =============================================

  @Get('drivers')
  async getDriverApplications(@Query('status') status?: string) {
    return this.adminService.getDriverApplications(status);
  }

  @Patch('drivers/:id/approve')
  async approveDriver(@Param('id') id: string) {
    return this.adminService.approveDriver(id);
  }

  @Patch('drivers/:id/reject')
  async rejectDriver(
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.adminService.rejectDriver(id, reason);
  }

  // =============================================
  // RESTAURANTS / VENDORS (PostgreSQL)
  // =============================================

  @Get('restaurants')
  async getRestaurantApplications(
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    return this.adminService.getRestaurantApplications(status, type);
  }

  @Get('vendors')
  async getAllVendors(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getAllVendors({ page, limit, type, status, search });
  }

  @Patch('restaurants/:id/approve')
  async approveRestaurant(@Param('id') id: string) {
    return this.adminService.approveRestaurant(id);
  }

  @Patch('restaurants/:id/reject')
  async rejectRestaurant(
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.adminService.rejectRestaurant(id, reason);
  }

  @Patch('vendors/:id/status')
  async updateVendorStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    return this.adminService.updateVendorStatus(id, status);
  }

  // =============================================
  // FIREBASE VENDOR APPLICATIONS
  // =============================================

  @Get('vendor-applications')
  async getVendorApplications(@Query('status') status?: string) {
    return this.adminService.getVendorApplicationsFromFirebase(status);
  }

  @Patch('vendor-applications/:id/approve')
  async approveVendorApplication(@Param('id') id: string) {
    return this.adminService.approveFirebaseVendorApplication(id);
  }

  @Patch('vendor-applications/:id/reject')
  async rejectVendorApplication(
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.adminService.rejectFirebaseVendorApplication(id, reason);
  }

  // =============================================
  // FIREBASE DRIVER APPLICATIONS
  // =============================================

  @Get('driver-applications')
  async getDriverApplicationsFromFirebase(@Query('status') status?: string) {
    return this.adminService.getDriverApplicationsFromFirebase(status);
  }

  @Patch('driver-applications/:id/approve')
  async approveDriverApplication(@Param('id') id: string) {
    return this.adminService.approveFirebaseDriverApplication(id);
  }

  @Patch('driver-applications/:id/reject')
  async rejectDriverApplication(
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.adminService.rejectFirebaseDriverApplication(id, reason);
  }

  // =============================================
  // ORDERS
  // =============================================

  @Get('orders')
  async getAllOrders(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getAllOrders({ page, limit, status, search });
  }

  @Get('orders/:id')
  async getOrderById(@Param('id') id: string) {
    return this.adminService.getOrderById(id);
  }

  @Get('transactions/export')
  async exportTransactions(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.adminService.exportTransactionsCsv({ startDate, endDate });
  }

  // =============================================
  // SETTLEMENTS
  // =============================================

  @Get('settlements')
  async getSettlements() {
    return this.adminService.getSettlements();
  }

  @Post('settlements/payout')
  async processPayout(@Body() dto: { userId: string, amount: number, notes?: string }) {
    return this.adminService.processPayout(dto);
  }

  // =============================================
  // SETTINGS
  // =============================================

  @Get('settings')
  async getSettings() {
    return this.adminService.getSettings();
  }

  @Patch('settings')
  async updateSettings(@Body() dto: any) {
    return this.adminService.updateSettings(dto);
  }

  // =============================================
  // AUDIT LOGS
  // =============================================

  @Get('audit-logs')
  async getAuditLogs(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.adminService.getAuditLogs(page, limit);
  }

  // =============================================
  // COMBINED PENDING APPLICATIONS
  // =============================================

  @Get('pending-applications')
  async getPendingApplications() {
    return this.adminService.getPendingApplications();
  }

  @Get('map-data')
  async getMapData() {
    return this.adminService.getMapData();
  }

  @Get('reconcile')
  async reconcileFinancials() {
    return this.adminService.reconcileFinancials();
  }

  @Get('export/:type')
  async exportData(@Param('type') type: 'orders' | 'settlements', @Response() res: any) {
    const csv = await this.adminService.getExportData(type);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${type}_export_${new Date().toISOString().split('T')[0]}.csv`);
    return res.send(csv);
  }
}
