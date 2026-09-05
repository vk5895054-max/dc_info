import { Controller, Get, Post, Put, Delete, Param, Body, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import type { Request } from 'express';
import { TemplateService } from './template.service';
import { CreateTemplateDto, UpdateTemplateDto, TemplateResponseDto } from './dto';
import { Template } from './entities/template.entity';
import { RequireRole, CurrentApiKey } from '../auth/decorators/auth.decorators';
import { ApiKey, ApiKeyRole } from '../auth/entities/api-key.entity';

@ApiTags('templates')
@Controller('sessions/:sessionId/templates')
export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  @Post()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Create a message template for the session (image+text simple)' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 201, description: 'Template created', type: TemplateResponseDto })
  @ApiResponse({ status: 409, description: 'A template with that name already exists for the session' })
  async create(@Param('sessionId') sessionId: string, @Body() dto: CreateTemplateDto, @CurrentApiKey() apiKey?: ApiKey, @Req() req?: Request): Promise<Template> {
    const role = (apiKey as any)?.role as string | undefined;
    const headerEmail = (req as any)?.headers?.['x-admin-email'] as string | undefined;
    (dto as any).createdByEmail = headerEmail || (apiKey as any)?.email || (apiKey as any)?.name || null;
    (dto as any).createdByRole = role || null;
    if (role === 'reseller') (dto as any).resellerId = apiKey?.id;
    if (role === 'user') (dto as any).userId = apiKey?.id;
    return this.templateService.create(sessionId, dto);
  }

  @Get('history/all')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'History: light list of all templates (admin history view)' })
  async history(): Promise<any> {
    return this.templateService.history();
  }

  @Get()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'List templates for a session (filtered for reseller/user, all for admin)' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'List of templates', type: [TemplateResponseDto] })
  async findBySession(@Param('sessionId') sessionId: string, @CurrentApiKey() apiKey?: ApiKey, @Req() req?: Request): Promise<Template[]> {
    const role = (apiKey as any)?.role as string | undefined;
    const isAdmin = role === 'admin' || role === 'super_admin';
    if (isAdmin) return this.templateService.findBySession(sessionId);
    const headerEmail = (req as any)?.headers?.['x-admin-email'] as string | undefined;
    const email = headerEmail || (apiKey as any)?.email || (apiKey as any)?.name || null;
    return this.templateService.findBySession(sessionId, { createdByEmail: email, role, resellerId: apiKey?.id, userId: apiKey?.id, isAdmin: false });
  }

  @Get(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Get a template by ID' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  @ApiResponse({ status: 200, description: 'Template details', type: TemplateResponseDto })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async findOne(@Param('sessionId') sessionId: string, @Param('id') id: string): Promise<Template> {
    return this.templateService.findOne(sessionId, id);
  }

  @Put(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Update a template' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  @ApiResponse({ status: 200, description: 'Template updated', type: TemplateResponseDto })
  @ApiResponse({ status: 404, description: 'Template not found' })
  @ApiResponse({ status: 409, description: 'A template with that name already exists for the session' })
  async update(
    @Param('sessionId') sessionId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
  ): Promise<Template> {
    return this.templateService.update(sessionId, id, dto);
  }

  @Delete(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a template' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  @ApiResponse({ status: 204, description: 'Template deleted' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async delete(@Param('sessionId') sessionId: string, @Param('id') id: string): Promise<void> {
    return this.templateService.delete(sessionId, id);
  }
}
