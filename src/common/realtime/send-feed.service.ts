import { Injectable } from '@nestjs/common';

/**
 * Per-recipient send event published by the bulk engine the moment the engine
 * accepts a message. Deliberately OUTSIDE the console-log pipeline: operators poll
 * or stream these via the SSE feed for live visibility while pm2 logs stay quiet.
 */
export interface SendFeedEvent {
  campaignId: string;
  campaignName: string;
  sessionId: string;
  sessionName: string;
  chatId: string;
  phone: string;
  messageType: string;
  status: 'sent';
  messageId?: string;
  at: string;
}

/**
 * In-process event bus for per-recipient send events. Backed by a small ring buffer
 * so a client that connects after a send has started can replay the recent tail.
 * No console.log here by design — "don't show in logs".
 */
@Injectable()
export class SendFeedService {
  private readonly listeners = new Set<(event: SendFeedEvent) => void>();
  private readonly ring: SendFeedEvent[] = [];
  private readonly RING_MAX = 1000;

  subscribe(listener: (event: SendFeedEvent) => void): { unsubscribe: () => void } {
    this.listeners.add(listener);
    return { unsubscribe: () => this.listeners.delete(listener) };
  }

  replay(): SendFeedEvent[] {
    return [...this.ring];
  }

  publish(event: SendFeedEvent): void {
    this.ring.push(event);
    if (this.ring.length > this.RING_MAX) this.ring.shift();
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // a slow/broken feed consumer must never break the send engine
      }
    }
  }
}