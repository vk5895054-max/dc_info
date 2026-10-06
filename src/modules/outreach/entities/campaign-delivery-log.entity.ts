import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm';

/**
 * Append-only log of every recipient delivery outcome per campaign burst.
 * Written in batch INSERTs when a burst completes (not one-by-one per message).
 * The `messages` table is the global chat history; this table is the per-campaign
 * delivery ledger for reporting, CSV export, and analytics at scale.
 */
@Entity('campaign_delivery_log')
@Unique('UQ_campaign_delivery_log_batch_phone', ['batchId', 'phone'])
export class CampaignDeliveryLog {
  @PrimaryGeneratedColumn({ type: 'bigint', name: 'id' })
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId!: string;

  @Index()
  @Column({ type: 'text', name: 'batch_id' })
  batchId!: string;

  @Index()
  @Column({ type: 'text', name: 'session_id' })
  sessionId!: string;

  @Index()
  @Column({ type: 'text', name: 'phone' })
  phone!: string;

  /** sent | delivered | read | failed | blocked | cancelled */
  @Column({ type: 'text', name: 'status', default: 'sent' })
  status!: string;

  @Column({ type: 'text', name: 'wa_message_id', nullable: true })
  waMessageId!: string | null;

  @Column({ type: 'text', name: 'message_type', nullable: true })
  messageType!: string | null;

  @Column({ type: 'text', name: 'error_code', nullable: true })
  errorCode!: string | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'timestamptz', name: 'sent_at', nullable: true })
  sentAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}