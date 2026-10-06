import { Controller, Get, Logger, Query, Req, Res } from '@nestjs/common';
import type { Response, Request } from 'express';
import { SendFeedService } from '../../common/realtime/send-feed.service';

/**
 * Server-Sent Events feed of per-recipient send events ("this session sent this number
 * successfully") in real time. Not part of the console logs — clients open this stream
 * to watch campaigns live. Optional last=<n> query replays the most recent n events after
 * the connection opens (on top of live events). Returns plain SSE; aborting the request
 * unsubscribes automatically.
 */
@Controller('outreach/feed')
export class SendFeedController {
  private readonly logger = new Logger(SendFeedController.name);

  constructor(private readonly feed: SendFeedService) {}

  @Get()
  stream(@Req() req: Request, @Res() res: Response, @Query('last') last?: string): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write('retry: 3000\n\n');

    const send = (event: { campaignId: string; campaignName: string; sessionId: string; sessionName: string; chatId: string; phone: string; messageType: string; status: string; messageId?: string; at: string }): void => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // client went away mid-write; cleanup below handles the unsubscribe
      }
    };

    const replayCount = Number(last) || 0;
    if (replayCount > 0) {
      for (const event of this.feed.replay().slice(-replayCount)) {
        send(event);
      }
    }

    const sub = this.feed.subscribe(event => send(event));
    const onClose = (): void => {
      sub.unsubscribe();
      res.end();
    };
    req.on('close', onClose);
  }
}