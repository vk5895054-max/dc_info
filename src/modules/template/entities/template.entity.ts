import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Session } from '../../session/entities/session.entity';

// One template name per session: makes resolve-by-name deterministic and rejects duplicates.
// Mirrored by the AddTemplateNameUnique migration for non-synchronize (Postgres / opted-out) DBs.
@Index('IDX_templates_session_name', ['sessionId', 'name'], { unique: true })
@Entity('templates')
export class Template {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // varchar (not uuid) to match the authoritative migration DDL and sessions.id; the data connection
  // runs synchronize:false, so a 'uuid' decorator here would only mislead schema diffs / a stray sync.
  @Column({ type: 'varchar' })
  sessionId!: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session!: Session;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'text', nullable: true })
  header!: string | null;

  @Column({ type: 'text', nullable: true })
  footer!: string | null;

  // Flexible media template — like Message Tester: image/file with caption, not bulk-ish text only
  @Column({ type: 'varchar', length: 20, nullable: true, default: 'text' })
  mediaType!: string | null; // text | image | video | audio | document

  @Column({ type: 'text', nullable: true })
  mediaUrl!: string | null; // https URL or Supabase public URL

  @Column({ type: 'text', nullable: true })
  mediaBase64!: string | null; // fallback inline base64 (small assets) when Supabase not configured

  @Column({ type: 'varchar', length: 120, nullable: true })
  mimetype!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  filename!: string | null;

  @Column({ type: 'text', nullable: true })
  caption!: string | null; // caption rendered with {{vars}}, like Message Tester

  @Column({ type: 'varchar', length: 255, nullable: true })
  supabasePath!: string | null; // bucket path if stored in Supabase

  @Column({ type: 'varchar', nullable: true })
  createdByEmail!: string | null;

  @Column({ type: 'varchar', nullable: true })
  createdByRole!: string | null;

  @Column({ type: 'varchar', nullable: true })
  resellerId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  userId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
