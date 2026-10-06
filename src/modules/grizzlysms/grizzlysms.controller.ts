import { Controller, Get, Post, Param, Body, Query, Headers, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { GrizzlySmsService, BuyNumberOptions } from './grizzlysms.service';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { IsString, IsOptional, IsNumber } from 'class-validator';

class BuyNumberDto implements BuyNumberOptions {
  @IsOptional() @IsString() service?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsNumber() maxPrice?: number;
  @IsOptional() @IsString() providerIds?: string;
  @IsOptional() @IsString() exceptProviderIds?: string;
  @IsOptional() @IsString() phoneException?: string;
  @IsOptional() @IsNumber() minPrice?: number;
}

class SetStatusDto {
  @IsString()
  status!: string;
}

class TrackDto {
  @IsString()
  activationId!: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() service?: string;
  @IsOptional() @IsString() country?: string;
}

@ApiTags('grizzlysms')
@Controller('grizzlysms')
@RequireRole(ApiKeyRole.RESELLER)
export class GrizzlySmsController {
  constructor(private readonly grizzlySmsService: GrizzlySmsService) {}

  @Get('balance')
  @ApiOperation({ summary: 'Fresh GrizzlySMS balance, recorded to history' })
  async balance() {
    return this.grizzlySmsService.checkBalance();
  }

  @Get('balance/history')
  @ApiOperation({ summary: 'GrizzlySMS balance snapshots' })
  async balanceHistory(
    @Query('limit', new DefaultValuePipe(50), new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.grizzlySmsService.balanceHistory(limit ?? 50);
  }

  @Post('order')
  @ApiOperation({ summary: 'Buy a WhatsApp number (Indian, price ladder $1 -> $0.85 -> $0.75)' })
  async buyNumber(@Body() dto: BuyNumberDto) {
    return this.grizzlySmsService.buyNumber(dto);
  }

  @Post('track')
  @ApiOperation({ summary: 'Track an existing Grizzly activation in this profile (e.g. bought via CLI/MCP)' })
  async track(@Body() dto: TrackDto) {
    return this.grizzlySmsService.trackActivation(dto.activationId, dto);
  }

  @Get('order/:activationId/status')
  @ApiOperation({ summary: 'GrizzlySMS activation status' })
  async status(@Param('activationId') activationId: string) {
    return this.grizzlySmsService.getOrderStatus(activationId);
  }

  @Post('order/:activationId/status')
  @ApiOperation({ summary: 'Set GrizzlySMS activation status: 1 ready, 3 resend, 6 done, 8 cancel' })
  async setStatus(@Param('activationId') activationId: string, @Body() dto: SetStatusDto) {
    return this.grizzlySmsService.setOrderStatus(activationId, dto.status);
  }

  @Get('orders')
  @ApiOperation({ summary: 'GrizzlySMS order history (this profile DB)' })
  async orders(
    @Query('limit', new DefaultValuePipe(100), new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.grizzlySmsService.ordersList(limit ?? 100);
  }

  @Get('account/numbers')
  @ApiOperation({ summary: 'My bought numbers, live from the Grizzly account API (Bearer JWT ~1h; send X-Grizzly-Token or set GRIZZLYSMS_ACCOUNT_TOKEN)' })
  async accountNumbers(@Headers('x-grizzly-token') token?: string) {
    return this.grizzlySmsService.accountNumbers(token);
  }
}