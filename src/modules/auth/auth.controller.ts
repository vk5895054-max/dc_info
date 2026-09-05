import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { CreateApiKeyDto, UpdateApiKeyDto, ApiKeyResponseDto, ApiKeyCreatedResponseDto } from './dto';
import { RequireRole, CurrentApiKey, RequireUnscopedKey } from './decorators/auth.decorators';
import { type ApiKey, ApiKeyRole } from './entities/api-key.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from './../audit/entities/audit-log.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResellerUser } from './entities/reseller-user.entity';

@ApiTags('auth')
@Controller('auth/api-keys')
// Key lifecycle routes have no session dimension, so a session-scoped ADMIN key could otherwise
// escape its confinement here (mint an unrestricted key, or clear another key's allowedSessions).
@RequireUnscopedKey()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    @InjectRepository(ResellerUser, 'main')
    private readonly resellerUserRepo: Repository<ResellerUser>,
  ) {}

  // Build the request-context block for an API-key lifecycle audit entry: who did it (the admin key from
  // the guard), the resolved client IP, and the HTTP method/path.
  private auditContext(
    req: Request,
    actor?: ApiKey,
  ): { apiKey?: ApiKey; ipAddress?: string; method?: string; path?: string } {
    return {
      apiKey: actor,
      ipAddress: (req as Request & { clientIp?: string }).clientIp ?? undefined,
      method: req.method,
      path: req.path,
    };
  }

  @Post()
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Create a new API key (admin only)' })
  @ApiResponse({
    status: 201,
    description: 'API key created',
    type: ApiKeyCreatedResponseDto,
  })
  async create(
    @Body() dto: CreateApiKeyDto,
    @Req() req: Request,
    @CurrentApiKey() actor?: ApiKey,
  ): Promise<ApiKeyCreatedResponseDto> {
    const { apiKey, rawKey } = await this.authService.createApiKey(dto, actor);
    // Return extended fields
    await this.auditService.logInfo(AuditAction.API_KEY_CREATED, {
      ...this.auditContext(req, actor),
      metadata: { targetKeyId: apiKey.id, targetKeyName: apiKey.name, role: apiKey.role },
    });
    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      role: apiKey.role,
      allowedIps: apiKey.allowedIps || undefined,
      allowedSessions: apiKey.allowedSessions || undefined,
      isActive: apiKey.isActive,
      expiresAt: apiKey.expiresAt || undefined,
      lastUsedAt: apiKey.lastUsedAt || undefined,
      usageCount: apiKey.usageCount,
      createdAt: apiKey.createdAt,
      credits: (apiKey as any).credits,
      creditsUsed: (apiKey as any).creditsUsed,
      creditCost: (apiKey as any).creditCost,
      creditsRemaining:
        (apiKey as any).credits != null ? (apiKey as any).credits - ((apiKey as any).creditsUsed || 0) : undefined,
      apiKey: rawKey,
    };
  }

  @Get()
  @RequireRole(ApiKeyRole.RESELLER)
  @ApiOperation({ summary: 'List API keys — admin sees all, reseller sees only own + their created reseller/user/demo' })
  @ApiResponse({
    status: 200,
    description: 'All API keys (the plaintext key is never returned; only the keyPrefix).',
    type: [ApiKeyResponseDto],
  })
  async findAll(@CurrentApiKey() actor?: ApiKey): Promise<ApiKeyResponseDto[]> {
    const role = (actor as any)?.role as string | undefined;
    const isAdmin = role === 'admin' || role === 'super_admin';
    if (isAdmin) {
      const keys = await this.authService.findAll();
      return keys.map(k => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        role: k.role,
        allowedIps: k.allowedIps || undefined,
        allowedSessions: k.allowedSessions || undefined,
        isActive: k.isActive,
        expiresAt: k.expiresAt || undefined,
        lastUsedAt: k.lastUsedAt || undefined,
        usageCount: k.usageCount,
        createdAt: k.createdAt,
        credits: (k as any).credits,
        creditsUsed: (k as any).creditsUsed,
        creditCost: (k as any).creditCost,
        creditsRemaining: (k as any).credits != null ? (k as any).credits - ((k as any).creditsUsed || 0) : undefined,
      }));
    }
    // Reseller: only own + users they created (via parentApiKeyId)
    if (role === 'reseller' && actor) {
      const ownedUsers = await this.resellerUserRepo.find({ where: { parentApiKeyId: actor.id } as any });
      const ownedApiKeyIds = ownedUsers.map(u => u.apiKeyId).filter(Boolean) as string[];
      const allRelevantIds = [...new Set([actor.id, ...ownedApiKeyIds])];
      const keys = await this.authService.findAllByIds(allRelevantIds);
      return keys.map(k => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        role: k.role,
        allowedIps: k.allowedIps || undefined,
        allowedSessions: k.allowedSessions || undefined,
        isActive: k.isActive,
        expiresAt: k.expiresAt || undefined,
        lastUsedAt: k.lastUsedAt || undefined,
        usageCount: k.usageCount,
        createdAt: k.createdAt,
        credits: (k as any).credits,
        creditsUsed: (k as any).creditsUsed,
        creditCost: (k as any).creditCost,
        creditsRemaining: (k as any).credits != null ? (k as any).credits - ((k as any).creditsUsed || 0) : undefined,
      }));
    }
    // Fallback for other roles (should not happen due to guard, but return own only)
    if (actor) {
      const k = await this.authService.findOne(actor.id);
      return [{
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        role: k.role,
        allowedIps: k.allowedIps || undefined,
        allowedSessions: k.allowedSessions || undefined,
        isActive: k.isActive,
        expiresAt: k.expiresAt || undefined,
        lastUsedAt: k.lastUsedAt || undefined,
        usageCount: k.usageCount,
        createdAt: k.createdAt,
        credits: (k as any).credits,
        creditsUsed: (k as any).creditsUsed,
        creditCost: (k as any).creditCost,
        creditsRemaining: (k as any).credits != null ? (k as any).credits - ((k as any).creditsUsed || 0) : undefined,
      }];
    }
    const keys = await this.authService.findAll();
    return keys.map(k => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      role: k.role,
      allowedIps: k.allowedIps || undefined,
      allowedSessions: k.allowedSessions || undefined,
      isActive: k.isActive,
      expiresAt: k.expiresAt || undefined,
      lastUsedAt: k.lastUsedAt || undefined,
      usageCount: k.usageCount,
      createdAt: k.createdAt,
      credits: (k as any).credits,
      creditsUsed: (k as any).creditsUsed,
      creditCost: (k as any).creditCost,
      creditsRemaining: (k as any).credits != null ? (k as any).credits - ((k as any).creditsUsed || 0) : undefined,
    }));
  }

  @Get(':id')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Get API key details (admin only)' })
  @ApiResponse({
    status: 200,
    description: 'The API key (plaintext never returned; only the keyPrefix).',
    type: ApiKeyResponseDto,
  })
  async findOne(@Param('id') id: string): Promise<ApiKeyResponseDto> {
    const k = await this.authService.findOne(id);
    return {
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      role: k.role,
      allowedIps: k.allowedIps || undefined,
      allowedSessions: k.allowedSessions || undefined,
      isActive: k.isActive,
      expiresAt: k.expiresAt || undefined,
      lastUsedAt: k.lastUsedAt || undefined,
      usageCount: k.usageCount,
      createdAt: k.createdAt,
      credits: (k as any).credits,
      creditsUsed: (k as any).creditsUsed,
      creditCost: (k as any).creditCost,
      creditsRemaining: (k as any).credits != null ? (k as any).credits - ((k as any).creditsUsed || 0) : undefined,
    };
  }

  @Put(':id')
  @RequireRole(ApiKeyRole.RESELLER)
  @ApiOperation({ summary: 'Update API key (admin: all, reseller: only own created)' })
  @ApiResponse({ status: 200, description: 'The updated API key.', type: ApiKeyResponseDto })
  @ApiResponse({ status: 409, description: 'The change would remove the last usable admin key.' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateApiKeyDto,
    @Req() req: Request,
    @CurrentApiKey() actor?: ApiKey,
  ): Promise<ApiKeyResponseDto> {
    const role = (actor as any)?.role as string | undefined;
    if (role === 'reseller' && actor) {
      const owned = await this.resellerUserRepo.findOne({ where: { apiKeyId: id, parentApiKeyId: actor.id } as any });
      const isSelf = id === actor.id;
      if (!owned && !isSelf) throw new UnauthorizedException('Not authorized to update this user');
    }
    const before = await this.authService.findOne(id);
    const k = await this.authService.update(id, dto);
    const authzSnapshot = (key: ApiKey) => ({
      role: key.role,
      allowedIps: key.allowedIps,
      allowedSessions: key.allowedSessions,
      expiresAt: key.expiresAt,
    });
    await this.auditService.logInfo(AuditAction.API_KEY_UPDATED, {
      ...this.auditContext(req, actor),
      metadata: {
        targetKeyId: k.id,
        targetKeyName: k.name,
        before: authzSnapshot(before),
        after: authzSnapshot(k),
      },
    });
    return {
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      role: k.role,
      allowedIps: k.allowedIps || undefined,
      allowedSessions: k.allowedSessions || undefined,
      isActive: k.isActive,
      expiresAt: k.expiresAt || undefined,
      lastUsedAt: k.lastUsedAt || undefined,
      usageCount: k.usageCount,
      createdAt: k.createdAt,
      credits: (k as any).credits,
      creditsUsed: (k as any).creditsUsed,
      creditCost: (k as any).creditCost,
      creditsRemaining: (k as any).credits != null ? (k as any).credits - ((k as any).creditsUsed || 0) : undefined,
    };
  }

  @Delete(':id')
  @RequireRole(ApiKeyRole.RESELLER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete API key (admin: all, reseller: only own created users)' })
  @ApiResponse({ status: 204, description: 'API key deleted' })
  @ApiResponse({ status: 409, description: 'The key is the last usable admin key.' })
  async delete(@Param('id') id: string, @Req() req: Request, @CurrentApiKey() actor?: ApiKey): Promise<void> {
    const role = (actor as any)?.role as string | undefined;
    if (role === 'reseller' && actor) {
      // Reseller can only delete their own created users
      const owned = await this.resellerUserRepo.findOne({ where: { apiKeyId: id, parentApiKeyId: actor.id } as any });
      const isSelf = id === actor.id;
      if (!owned && !isSelf) throw new UnauthorizedException('Not authorized to delete this user');
    }
    const target = await this.authService.findOne(id);
    await this.authService.delete(id);
    // Also delete ResellerUser if exists
    try {
      const ru = await this.resellerUserRepo.findOne({ where: { apiKeyId: id } as any });
      if (ru) await this.resellerUserRepo.remove(ru);
    } catch {}
    await this.auditService.logInfo(AuditAction.API_KEY_DELETED, {
      ...this.auditContext(req, actor),
      metadata: { targetKeyId: id, targetKeyName: target?.name },
    });
  }

  @Post(':id/revoke')
  @RequireRole(ApiKeyRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke API key (admin only)' })
  @ApiResponse({ status: 200, description: 'The revoked API key (isActive now false).', type: ApiKeyResponseDto })
  @ApiResponse({ status: 409, description: 'The key is the last usable admin key.' })
  async revoke(
    @Param('id') id: string,
    @Req() req: Request,
    @CurrentApiKey() actor?: ApiKey,
  ): Promise<ApiKeyResponseDto> {
    const k = await this.authService.revoke(id);
    await this.auditService.logInfo(AuditAction.API_KEY_REVOKED, {
      ...this.auditContext(req, actor),
      metadata: { targetKeyId: k.id, targetKeyName: k.name },
    });
    return {
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      role: k.role,
      allowedIps: k.allowedIps || undefined,
      allowedSessions: k.allowedSessions || undefined,
      isActive: k.isActive,
      expiresAt: k.expiresAt || undefined,
      lastUsedAt: k.lastUsedAt || undefined,
      usageCount: k.usageCount,
      createdAt: k.createdAt,
    };
  }

  @Get(':id/credits')
  @ApiOperation({ summary: 'Get credit balance for an API key' })
  async getCredits(
    @Param('id') id: string,
    @CurrentApiKey() actor?: ApiKey,
  ): Promise<{
    credits: number | null;
    creditsUsed: number;
    creditsRemaining: number | null;
    creditCost: Record<string, number> | null;
  }> {
    // Demo can query own, admin can query any
    if (actor && actor.id !== id && actor.role !== ApiKeyRole.ADMIN) throw new UnauthorizedException('Not authorized');
    const k = await this.authService.findOne(id);
    return {
      credits: (k as any).credits ?? null,
      creditsUsed: (k as any).creditsUsed ?? 0,
      creditsRemaining: (k as any).credits != null ? (k as any).credits - ((k as any).creditsUsed ?? 0) : null,
      creditCost: (k as any).creditCost ?? null,
    };
  }

  @Get(':id/credit-history')
  @ApiOperation({ summary: 'Get credit usage history for an API key' })
  async creditHistory(@Param('id') id: string, @CurrentApiKey() actor?: ApiKey) {
    if (actor && actor.id !== id && actor.role !== ApiKeyRole.ADMIN) throw new UnauthorizedException('Not authorized');
    return this.authService.creditHistory(id);
  }

  @Post(':id/credits/add')
  @RequireRole(ApiKeyRole.RESELLER)
  @ApiOperation({ summary: 'Add credits to an API key (admin: all, reseller: only own created, deducts from reseller)' })
  async addCredits(@Param('id') id: string, @Body() body: { amount: number }, @CurrentApiKey() actor?: ApiKey): Promise<ApiKeyResponseDto> {
    const role = (actor as any)?.role as string | undefined;
    const amount = Number(body.amount) || 0;
    if (role === 'reseller' && actor) {
      const owned = await this.resellerUserRepo.findOne({ where: { apiKeyId: id, parentApiKeyId: actor.id } as any });
      if (!owned) throw new UnauthorizedException('Not authorized to add credits to this user');
      // Deduct from reseller's own credits
      const resellerKey = await this.authService.findOne(actor.id);
      const remaining = ((resellerKey as any).credits ?? 0) - (((resellerKey as any).creditsUsed ?? 0) + 0);
      // Check if reseller has enough (if not unlimited)
      if ((resellerKey as any).credits != null && amount > remaining) {
        throw new UnauthorizedException(`Insufficient credits: you have ${remaining} remaining, need ${amount}`);
      }
      if ((resellerKey as any).credits != null) {
        const newCredits = ((resellerKey as any).credits ?? 0) - amount;
        await this.authService.update(actor.id, { credits: newCredits } as any);
        // Also update ResellerUser parent credits
        const parentRu = await this.resellerUserRepo.findOne({ where: { apiKeyId: actor.id } as any });
        if (parentRu) {
          parentRu.credits = ((parentRu as any).credits ?? 0) - amount;
          await this.resellerUserRepo.save(parentRu);
        }
      }
    }
    const k = await this.authService.addCredits(id, amount);
    return {
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      role: k.role,
      allowedIps: k.allowedIps || undefined,
      allowedSessions: k.allowedSessions || undefined,
      isActive: k.isActive,
      expiresAt: k.expiresAt || undefined,
      lastUsedAt: k.lastUsedAt || undefined,
      usageCount: k.usageCount,
      createdAt: k.createdAt,
      credits: (k as any).credits,
      creditsUsed: (k as any).creditsUsed,
      creditCost: (k as any).creditCost,
    };
  }

  @Put(':id/credit-cost')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Set per-message credit cost map (admin only)' })
  async setCreditCost(
    @Param('id') id: string,
    @Body() body: { creditCost: Record<string, number> },
  ): Promise<ApiKeyResponseDto> {
    const k = await this.authService.setCreditCost(id, body.creditCost || {});
    return {
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      role: k.role,
      allowedIps: k.allowedIps || undefined,
      allowedSessions: k.allowedSessions || undefined,
      isActive: k.isActive,
      expiresAt: k.expiresAt || undefined,
      lastUsedAt: k.lastUsedAt || undefined,
      usageCount: k.usageCount,
      createdAt: k.createdAt,
      credits: (k as any).credits,
      creditsUsed: (k as any).creditsUsed,
      creditCost: (k as any).creditCost,
    };
  }
}
