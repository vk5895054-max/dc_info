import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutreachCampaign } from './entities/outreach-campaign.entity';
import { CampaignDeliveryLog } from './entities/campaign-delivery-log.entity';
import { Message } from '../message/entities/message.entity';
import { OutreachService } from './outreach.service';
import { OutreachController } from './outreach.controller';
import { SendFeedController } from './send-feed.controller';
import { SessionModule } from '../session/session.module';
import { MessageModule } from '../message/message.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([OutreachCampaign, CampaignDeliveryLog, Message], 'data'), SessionModule, MessageModule, AuthModule],
  controllers: [OutreachController, SendFeedController],
  providers: [OutreachService],
  exports: [OutreachService],
})
export class OutreachModule {}
