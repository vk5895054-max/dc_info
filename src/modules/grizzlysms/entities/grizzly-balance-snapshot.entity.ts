import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('grizzly_balance_snapshots')
export class GrizzlyBalanceSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'decimal', precision: 12, scale: 4 })
  balance!: number;

  @Column({ type: 'varchar', length: 10, nullable: true })
  currency!: string | null;

  @Column({ type: 'text', nullable: true })
  rawResponse!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}