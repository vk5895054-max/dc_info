import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('credit_ledger')
export class CreditLedger {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  apiKeyId!: string;

  @Column({ type: 'varchar', length: 32 })
  messageType!: string;

  @Column({ type: 'integer' })
  units!: number;

  @Column({ type: 'integer' })
  balanceAfter!: number;

  @Column({ type: 'varchar', length: 120, nullable: true })
  reference!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}