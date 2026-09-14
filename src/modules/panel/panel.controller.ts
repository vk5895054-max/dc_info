import { Body, Controller, Get, Put, Post, Param, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PanelService } from './panel.service';
import type { PanelHours } from './panel.service';
import { CurrentApiKey, RequireRole, Public } from '../auth/decorators/auth.decorators';
import { ApiKey, ApiKeyRole } from '../auth/entities/api-key.entity';
import type { Request } from 'express';

@ApiTags('panel')
@Controller('panel')
export class PanelController {
  constructor(private readonly panel: PanelService) {}

  @Get('hours')
  @Public()
  @ApiOperation({ summary: 'Get panel hours (public, used to check reseller/user window)' })
  getHours() {
    return this.panel.get();
  }

  @Get('hours/check')
  @ApiOperation({ summary: 'Check if current role is blocked by panel hours' })
  check(@CurrentApiKey() apiKey?: ApiKey, @Req() req?: Request) {
    const role = (apiKey as any)?.role as string | undefined;
    const email = ((req as any)?.headers?.['x-admin-email'] as string) || (apiKey as any)?.email || (apiKey as any)?.name || undefined;
    const res = this.panel.isBlocked(role, email);
    return { ...res.hours, blocked: res.blocked, role: role || null, email: email || null };
  }

  @Put('hours')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Set panel hours (admin/super_admin only) e.g. {enabled:true,startHour:10,endHour:18}' })
  setHours(@Body() dto: PanelHours) {
    return this.panel.save(dto);
  }

  @Post('requests')
  @RequireRole(ApiKeyRole.RESELLER)
  @ApiOperation({ summary: 'Reseller/user requests panel access for off-hours (pick username is auto, plus time of usage)' })
  createRequest(@Body() body: { requestedHours: string; reason?: string }, @CurrentApiKey() apiKey?: ApiKey, @Req() req?: Request) {
    const email = ((req as any)?.headers?.['x-admin-email'] as string) || (apiKey as any)?.email || (apiKey as any)?.name || '';
    const role = (apiKey as any)?.role as string || 'user';
    if (!email) throw new Error('Email not found for request');
    if (!body.requestedHours || String(body.requestedHours).trim().length < 2) throw new Error('requestedHours required e.g. 19:00-22:00');
    return this.panel.createRequest({ email, role, requestedHours: String(body.requestedHours).trim(), reason: body.reason });
  }

  @Get('requests')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Admin lists all panel access requests (with username, credit history fetched separately, time of usage)' })
  listRequests() {
    return this.panel.listRequests();
  }

  @Get('requests/me')
  @RequireRole(ApiKeyRole.RESELLER)
  @ApiOperation({ summary: 'List own requests' })
  listMyRequests(@CurrentApiKey() apiKey?: ApiKey, @Req() req?: Request) {
    const email = ((req as any)?.headers?.['x-admin-email'] as string) || (apiKey as any)?.email || (apiKey as any)?.name || '';
    return this.panel.listRequestsFor(email);
  }

  @Put('requests/:id')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Admin approve/reject request {status:approved|rejected, grantedHours?:number}' })
  updateRequest(@Param('id') id: string, @Body() body: { status: 'approved' | 'rejected'; grantedHours?: number }, @CurrentApiKey() apiKey?: ApiKey) {
    const grantedBy = (apiKey as any)?.email || (apiKey as any)?.name || 'admin';
    const res = this.panel.updateRequest(id, body.status, body.grantedHours, grantedBy);
    if (!res) throw new Error('Request not found');
    return res;
  }
}
