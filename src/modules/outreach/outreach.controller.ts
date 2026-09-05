import { Controller, Get, Post, Delete, Put, Param, Body, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { OutreachService } from './outreach.service';
import { CurrentApiKey } from '../auth/decorators/auth.decorators';
import { ApiKey } from '../auth/entities/api-key.entity';
import { AuthService } from '../auth/auth.service';
import { CreateOutreachCampaignDto, UpdateOutreachCampaignDto, OutreachCampaignResponseDto } from './dto/outreach-campaign.dto';

@ApiTags('Outreach')
@Controller('outreach/campaigns')
export class OutreachController {
  constructor(
    private readonly outreach: OutreachService,
    private readonly authService: AuthService,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a multi-session round-robin outreach campaign. Allocates the contact list across the ' +
      'given session pool (balanced, warm-up-capped), split into bursts separated by cool-downs.',
  })
  @ApiResponse({ status: 201, type: OutreachCampaignResponseDto })
  async create(
    @Body() dto: CreateOutreachCampaignDto,
    @CurrentApiKey() apiKey?: ApiKey,
    @Req() req?: Request,
  ): Promise<OutreachCampaignResponseDto> {
    // Assign reseller/user from apiKey if not provided — differentiate role
    const role = (apiKey as any)?.role as string | undefined;
    if (apiKey && !(dto as any).resellerId && role === 'reseller') (dto as any).resellerId = apiKey.id;
    if (apiKey && !(dto as any).userId && role === 'user') (dto as any).userId = apiKey.id;
    // Light history fields for admin view — prefer X-Admin-Email header (dashboard sends it)
    const headerEmail = (req as any)?.headers?.['x-admin-email'] as string | undefined;
    if (apiKey && !(dto as any).createdByEmail) {
      (dto as any).createdByEmail = headerEmail || (apiKey as any).email || (apiKey as any).name || null;
    }
    if (apiKey && !(dto as any).createdByRole) (dto as any).createdByRole = role || null;
    // Pre-check credits before creating campaign
    if (apiKey && (apiKey as any).credits != null) {
      const creditCost = (dto as any).creditCost ?? 1;
      const totalCost = dto.contacts.length * creditCost;
      const remaining = (apiKey as any).credits - ((apiKey as any).creditsUsed ?? 0);
      if (totalCost > remaining) {
        throw new Error(`Insufficient credits: need ${totalCost}, have ${remaining}`);
      }
    }
    const campaign = await this.outreach.create(dto);
    // Deduct credits after successful creation
    if (apiKey && (apiKey as any).credits != null) {
      const creditCost = (campaign as any).creditCost ?? (dto as any).creditCost ?? 1;
      const totalCost = (campaign as any).totalCredits ?? dto.contacts.length * creditCost;
      try {
        await this.authService.consumeCredit(apiKey.id, totalCost, 'campaign');
      } catch (e) {
        await this.outreach.remove(campaign.id).catch(() => {});
        throw e;
      }
    }
    return campaign;
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start a scheduled campaign (begins dispatching round-robin bursts).' })
  @ApiResponse({ status: 200, type: OutreachCampaignResponseDto })
  async start(@Param('id') id: string, @CurrentApiKey() apiKey?: ApiKey): Promise<OutreachCampaignResponseDto> {
    if (apiKey && (apiKey as any).credits != null) {
      const campaign = await this.outreach.status(id);
      const costMap = (apiKey as any).creditCost as Record<string, number> | null;
      const perContact = costMap?.['campaign'] ?? costMap?.['default'] ?? 1;
      const totalCost = (campaign.contactCount ?? 0) * perContact;
      await this.authService.consumeCredit(apiKey.id, totalCost, 'campaign');
    }
    return this.outreach.start(id);
  }

  @Post(':id/stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop a running campaign and cancel its in-flight batches.' })
  @ApiResponse({ status: 200, type: OutreachCampaignResponseDto })
  stop(@Param('id') id: string): Promise<OutreachCampaignResponseDto> {
    return this.outreach.stop(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a campaign (only when not running). Allows editing name, message, media, contacts, sessions.' })
  @ApiResponse({ status: 200, type: OutreachCampaignResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdateOutreachCampaignDto): Promise<OutreachCampaignResponseDto> {
    return this.outreach.update(id, dto as any);
  }

  @Get('history/all')
  @ApiOperation({ summary: 'Admin history: light list of all campaigns with creator and status (admin only)' })
  @ApiResponse({ status: 200 })
  async history(@CurrentApiKey() apiKey?: ApiKey): Promise<any> {
    const role = (apiKey as any)?.role as string | undefined;
    if (role !== 'admin' && role !== 'super_admin') {
      return this.outreach.list({ resellerId: apiKey?.id, userId: apiKey?.id, createdByEmail: (apiKey as any)?.email || (apiKey as any)?.name, role, isAdmin: false });
    }
    return this.outreach.history();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a campaign status and per-session progress.' })
  @ApiResponse({ status: 200, type: OutreachCampaignResponseDto })
  status(@Param('id') id: string): Promise<OutreachCampaignResponseDto> {
    return this.outreach.status(id);
  }

  @Get(':id/execution')
  @ApiOperation({
    summary: 'Campaign execution report: per-recipient sent/failed/pending results from all batch statuses.',
  })
  @ApiResponse({ status: 200 })
  execution(@Param('id') id: string) {
    return this.outreach.executionReport(id);
  }

  @Get()
  @ApiOperation({ summary: 'List outreach campaigns (filtered for reseller/user, all for admin).' })
  @ApiResponse({ status: 200, type: [OutreachCampaignResponseDto] })
  async list(@CurrentApiKey() apiKey?: ApiKey): Promise<OutreachCampaignResponseDto[]> {
    const role = (apiKey as any)?.role as string | undefined;
    const isAdmin = role === 'admin' || role === 'super_admin';
    if (isAdmin) return this.outreach.list({ isAdmin: true });
    return this.outreach.list({ resellerId: apiKey?.id, userId: apiKey?.id, createdByEmail: (apiKey as any)?.email || (apiKey as any)?.name, role, isAdmin: false });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a campaign (must not be running).' })
  @ApiResponse({ status: 200 })
  remove(@Param('id') id: string): Promise<{ deleted: boolean }> {
    return this.outreach.remove(id);
  }
}
