import { Global, Module } from '@nestjs/common';
import { SendFeedService } from './send-feed.service';

/**
 * Global per-recipient send-feed bus. Global so the bulk send engine (MessageModule) can
 * publish real-time "session X sent number Y successfully" events for pickup at the SSE
 * feed without a module import cycle (Message → Outreach → Message).
 */
@Global()
@Module({
  providers: [SendFeedService],
  exports: [SendFeedService],
})
export class SendFeedModule {}