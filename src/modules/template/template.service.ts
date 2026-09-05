import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Template } from './entities/template.entity';
import { CreateTemplateDto, UpdateTemplateDto } from './dto';
import { createLogger } from '../../common/services/logger.service';
import { isUniqueViolation } from '../../common/utils/db-errors';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class TemplateService {
  private readonly logger = createLogger('TemplateService');

  constructor(
    @InjectRepository(Template, 'data')
    private readonly templateRepository: Repository<Template>,
    @Optional()
    private readonly supabaseService?: SupabaseService,
  ) {}

  async create(sessionId: string, dto: CreateTemplateDto): Promise<Template> {
    // If Supabase is configured and mediaBase64 provided, upload to Supabase for persistent public URL (flexible, like Message Tester)
    let supabasePath = (dto as any).supabasePath ?? null;
    let mediaUrl = (dto as any).mediaUrl ?? null;
    let mediaBase64 = (dto as any).mediaBase64 ?? null;
    if (mediaBase64 && this.supabaseService?.isConfigured()) {
      try {
        const buffer = Buffer.from(mediaBase64, 'base64');
        const filename = (dto as any).filename || `template-${Date.now()}`;
        const mimetype = (dto as any).mimetype || 'application/octet-stream';
        const uploaded = await this.supabaseService.uploadTemplateMedia(buffer, filename, mimetype);
        if (uploaded) {
          mediaUrl = uploaded.publicUrl;
          supabasePath = uploaded.path;
          mediaBase64 = null; // prefer Supabase URL over inline base64
        }
      } catch {}
    }
    const template = this.templateRepository.create({
      sessionId,
      name: dto.name,
      body: dto.body,
      header: dto.header ?? null,
      footer: dto.footer ?? null,
      mediaType: (dto as any).mediaType || 'text',
      mediaUrl,
      mediaBase64,
      mimetype: (dto as any).mimetype ?? null,
      filename: (dto as any).filename ?? null,
      caption: (dto as any).caption ?? null,
      supabasePath,
      createdByEmail: (dto as any).createdByEmail ?? null,
      createdByRole: (dto as any).createdByRole ?? null,
      resellerId: (dto as any).resellerId ?? null,
      userId: (dto as any).userId ?? null,
    } as any);

    try {
      const saved = (await this.templateRepository.save(template)) as unknown as Template;
      this.logger.log('Template created', { sessionId, templateId: saved.id, name: saved.name });
      return saved;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(`A template named '${dto.name}' already exists for this session`);
      }
      throw err;
    }
  }

  async findBySession(sessionId: string, filter?: { createdByEmail?: string; role?: string; resellerId?: string; userId?: string; isAdmin?: boolean }): Promise<Template[]> {
    if (filter && !filter.isAdmin) {
      // Reseller/user see only own templates (light, no heavy joins)
      const where: any = { sessionId };
      if (filter.role === 'reseller' && filter.resellerId) where.resellerId = filter.resellerId;
      else if (filter.role === 'user' && filter.userId) where.userId = filter.userId;
      else if (filter.createdByEmail) where.createdByEmail = filter.createdByEmail;
      else {
        // fallback: filter in memory for demo (createdByEmail)
        const all = await this.templateRepository.find({ where: { sessionId }, order: { createdAt: 'DESC' } });
        return all.filter(t => (t as any).resellerId === filter.resellerId || (t as any).userId === filter.userId || (t as any).createdByEmail === filter.createdByEmail);
      }
      const filtered = await this.templateRepository.find({ where, order: { createdAt: 'DESC' } } as any);
      // If no results and templates have no creator (legacy), fallback to all for that session (avoid empty for old data)
      if (filtered.length === 0) {
        const all = await this.templateRepository.find({ where: { sessionId }, order: { createdAt: 'DESC' } });
        const legacy = all.filter(t => !(t as any).createdByEmail && !(t as any).resellerId && !(t as any).userId);
        if (legacy.length > 0) return legacy;
      }
      return filtered;
    }
    return this.templateRepository.find({
      where: { sessionId },
      order: { createdAt: 'DESC' },
    });
  }

  async history(): Promise<Array<{ id: string; name: string; body: string; mediaType: string | null; createdByEmail: string | null; createdByRole: string | null; sessionId: string; createdAt: Date }>> {
    const all = await this.templateRepository.find({ order: { createdAt: 'DESC' } });
    return all.map(t => ({
      id: t.id,
      name: t.name,
      body: (t.body || '').slice(0, 120),
      mediaType: (t as any).mediaType || 'text',
      createdByEmail: (t as any).createdByEmail || null,
      createdByRole: (t as any).createdByRole || null,
      sessionId: t.sessionId,
      createdAt: t.createdAt,
    }));
  }

  async findOne(sessionId: string, id: string): Promise<Template> {
    const template = await this.templateRepository.findOne({ where: { id, sessionId } });
    if (!template) {
      throw new NotFoundException(`Template with id '${id}' not found`);
    }
    return template;
  }

  /**
   * Resolve a template for a session by id or by name. Throws NotFoundException
   * when neither identifier matches. Used by the send-template message flow.
   */
  async resolve(sessionId: string, identifier: { templateId?: string; templateName?: string }): Promise<Template> {
    const { templateId, templateName } = identifier;

    if (templateId) {
      return this.findOne(sessionId, templateId);
    }

    if (templateName) {
      // Order by createdAt ASC so resolution is deterministic if more than one row shares a name
      // (possible only on a DB predating the unique index); the migration keeps the earliest too.
      const template = await this.templateRepository.findOne({
        where: { name: templateName, sessionId },
        order: { createdAt: 'ASC' },
      });
      if (!template) {
        throw new NotFoundException(`Template with name '${templateName}' not found`);
      }
      return template;
    }

    throw new NotFoundException('Either templateId or templateName must be provided');
  }

  async update(sessionId: string, id: string, dto: UpdateTemplateDto): Promise<Template> {
    const template = await this.findOne(sessionId, id);

    // Supabase upload on update if new base64 provided
    if ((dto as any).mediaBase64 && this.supabaseService?.isConfigured()) {
      try {
        const buffer = Buffer.from((dto as any).mediaBase64, 'base64');
        const filename = (dto as any).filename || `template-${Date.now()}`;
        const mimetype = (dto as any).mimetype || 'application/octet-stream';
        const uploaded = await this.supabaseService.uploadTemplateMedia(buffer, filename, mimetype);
        if (uploaded) {
          (dto as any).mediaUrl = uploaded.publicUrl;
          (dto as any).supabasePath = uploaded.path;
          (dto as any).mediaBase64 = null;
        }
      } catch {}
    }

    if (dto.name !== undefined) template.name = dto.name;
    if (dto.body !== undefined) template.body = dto.body;
    if (dto.header !== undefined) template.header = dto.header;
    if (dto.footer !== undefined) template.footer = dto.footer;
    if ((dto as any).mediaType !== undefined) (template as any).mediaType = (dto as any).mediaType;
    if ((dto as any).mediaUrl !== undefined) (template as any).mediaUrl = (dto as any).mediaUrl;
    if ((dto as any).mediaBase64 !== undefined) (template as any).mediaBase64 = (dto as any).mediaBase64;
    if ((dto as any).mimetype !== undefined) (template as any).mimetype = (dto as any).mimetype;
    if ((dto as any).filename !== undefined) (template as any).filename = (dto as any).filename;
    if ((dto as any).caption !== undefined) (template as any).caption = (dto as any).caption;
    if ((dto as any).supabasePath !== undefined) (template as any).supabasePath = (dto as any).supabasePath;

    try {
      return await this.templateRepository.save(template);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(`A template named '${template.name}' already exists for this session`);
      }
      throw err;
    }
  }

  async delete(sessionId: string, id: string): Promise<void> {
    const template = await this.findOne(sessionId, id);
    await this.templateRepository.remove(template);
    this.logger.log('Template deleted', { sessionId, templateId: id });
  }
}
