import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrizzlyOrder } from './entities/grizzly-order.entity';
import { GrizzlyBalanceSnapshot } from './entities/grizzly-balance-snapshot.entity';
import { GrizzlySmsService } from './grizzlysms.service';
import { GrizzlySmsController } from './grizzlysms.controller';

@Module({
  imports: [TypeOrmModule.forFeature([GrizzlyOrder, GrizzlyBalanceSnapshot], 'data')],
  providers: [GrizzlySmsService],
  controllers: [GrizzlySmsController],
  exports: [GrizzlySmsService],
})
export class GrizzlySmsModule {}