import { Controller, Post, Get, Delete, Body, Param, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { ResellerService } from './reseller.service';
import { CurrentApiKey, RequireRole } from './decorators/auth.decorators';
import { Public } from './decorators/auth.decorators';
import { ApiKey, ApiKeyRole } from './entities/api-key.entity';
import { IsEmail, IsString, MinLength, IsOptional, IsNumber } from 'class-validator';

class CreateResellerDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(3) password!: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() credits?: number;
  @IsOptional() creditCost?: Record<string, number>;
}

class ResellerLoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}

@ApiTags('reseller')
@Controller('auth/reseller')
export class ResellerController {
  constructor(private readonly resellerService: ResellerService) {}

  @Post('create')
  @RequireRole(ApiKeyRole.RESELLER)
  @ApiOperation({ summary: 'Create reseller/demo user with email/password (admin/reseller — reseller can create reseller/user/demo with credit deduction)' })
  async create(@Body() dto: CreateResellerDto, @Req() req: Request, @CurrentApiKey() actor?: ApiKey) {
    const actorEmail =
      (req as any).adminEmail ||
      (actor as any)?.email ||
      ((req.headers as any)['x-admin-email'] as string | undefined) ||
      undefined;
    // Also try sessionStorage email is not available server-side; frontend sends x-admin-email header
    const headerEmail = (req.headers['x-admin-email'] as string) || actorEmail;
    const actorRole = (actor as any)?.role || undefined;
    const actorApiKeyId = (actor as any)?.id || undefined;
    const result = await this.resellerService.createDemoUser(dto, headerEmail || 'infyle@infyle.com', actorRole, actorApiKeyId);
    return {
      id: result.user.id,
      email: result.user.email,
      role: result.user.role,
      apiKey: result.rawKey,
      credits: result.user.credits,
    };
  }

  @Post('login')
  @Public()
  @ApiOperation({ summary: 'Demo user login with email/password -> returns apiKey' })
  async login(@Body() dto: ResellerLoginDto) {
    const res = await this.resellerService.verify(dto.email, dto.password);
    if (!res) throw new Error('Invalid email or password');
    return {
      success: true,
      email: res.user.email,
      role: res.user.role,
      apiKey: res.rawKey,
      credits: res.user.credits,
      apiKeyId: res.user.apiKeyId,
    };
  }

  @Get('list')
  @RequireRole(ApiKeyRole.RESELLER)
  async list(@CurrentApiKey() actor?: ApiKey) {
    const role = (actor as any)?.role as string | undefined;
    const isAdmin = role === 'admin' || role === 'super_admin';
    if (isAdmin) return this.resellerService.list();
    if (actor) {
      const owned = await this.resellerService.listForParent(actor.id);
      // Include self for completeness
      const self = await this.resellerService.findByApiKeyId(actor.id);
      const all = self ? [self, ...owned] : owned;
      return all;
    }
    return this.resellerService.list();
  }

  @Delete(':id')
  @RequireRole(ApiKeyRole.RESELLER)
  async remove(@Param('id') id: string, @CurrentApiKey() actor?: ApiKey) {
    // Reseller can only delete their own created users
    const role = (actor as any)?.role as string | undefined;
    if (role === 'reseller' && actor) {
      const target = await this.resellerService.findById(id);
      if (target && (target as any).parentApiKeyId !== actor.id && target.apiKeyId !== actor.id) {
        throw new Error('Not authorized to delete this user');
      }
    }
    await this.resellerService.delete(id);
    return { deleted: true };
  }
}
