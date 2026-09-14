import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutreachCampaign } from './entities/outreach-campaign.entity';
import { Message } from '../message/entities/message.entity';
import { OutreachService } from './outreach.service';
import { OutreachController } from './outreach.controller';
import { SessionModule } from '../session/session.module';
import { MessageModule } from '../message/message.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([OutreachCampaign, Message], 'data'), SessionModule, MessageModule, AuthModule],
  controllers: [OutreachController],
  providers: [OutreachService],
  exports: [OutreachService],
})
export class OutreachModule {}
