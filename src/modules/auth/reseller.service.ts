import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { ResellerUser } from './entities/reseller-user.entity';
import { AuthService } from './auth.service';

@Injectable()
export class ResellerService {
  constructor(
    @InjectRepository(ResellerUser, 'main')
    private readonly userRepo: Repository<ResellerUser>,
    private readonly authService: AuthService,
  ) {}

  async createDemoUser(
    dto: {
      email: string;
      password: string;
      role?: string;
      credits?: number;
      creditCost?: Record<string, number>;
      name?: string;
    },
    actorEmail?: string,
    actorRole?: string,
    actorApiKeyId?: string,
  ): Promise<{ user: ResellerUser; rawKey: string }> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.userRepo.findOne({ where: { email } });
    if (existing) throw new ConflictException('Email already exists');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const role = dto.role || 'demo';
    // Only super admin infyle@infyle.com can create admin
    if (role === 'admin' && actorEmail?.toLowerCase() !== 'infyle@infyle.com') {
      throw new ConflictException('Only main admin (infyle@infyle.com) can create admin users');
    }
    // Reseller can create reseller/user/demo (with credit deduction)
    if (actorRole === 'reseller' && !['reseller', 'user', 'demo'].includes(role)) {
      throw new ConflictException('Reseller can only create reseller, user or demo accounts');
    }
    // Resolve parent reseller for tracking and credit deduction
    let parent: ResellerUser | null = null;
    if (actorRole === 'reseller') {
      if (actorApiKeyId) parent = await this.userRepo.findOne({ where: { apiKeyId: actorApiKeyId } });
      if (!parent && actorEmail) parent = await this.userRepo.findOne({ where: { email: actorEmail.toLowerCase().trim() } });
    }
    // Credit deduction for reseller -> reseller/user/demo transfer
    const requestedCredits = Number(dto.credits) || 0;
    if (actorRole === 'reseller' && requestedCredits > 0 && parent) {
      const parentCredits = parent.credits ?? null; // null = unlimited
      if (parentCredits != null) {
        try {
          if (!parent.apiKeyId) throw new ConflictException('Parent apiKey missing');
          const parentKey = await this.authService.findOne(parent.apiKeyId);
          const keyRemaining = (parentKey as any).credits != null ? (parentKey as any).credits - ((parentKey as any).creditsUsed || 0) : null;
          const available = keyRemaining != null ? keyRemaining : parentCredits;
          if (requestedCredits > available) {
            throw new ConflictException(`Insufficient credits: parent has ${available} remaining, ${requestedCredits} requested`);
          }
          // Deduct from parent ApiKey credits and ResellerUser credits
          const newParentCredits = ((parentKey as any).credits ?? 0) - requestedCredits;
          await this.authService.update(parent.apiKeyId!, { credits: newParentCredits } as any);
          parent.credits = (parent.credits ?? 0) - requestedCredits;
          await this.userRepo.save(parent);
        } catch (e) {
          if ((e as any)?.status === 409) throw e;
          if (requestedCredits > (parent.credits ?? 0)) {
            throw new ConflictException(`Insufficient credits: parent has ${parent.credits} remaining`);
          }
          parent.credits = (parent.credits ?? 0) - requestedCredits;
          await this.userRepo.save(parent);
        }
      }
    }
    const { apiKey, rawKey } = await this.authService.createApiKey({
      name: dto.name || email,
      role: role as any,
      credits: dto.credits,
      creditCost: dto.creditCost,
    });
    const user = this.userRepo.create({
      email,
      passwordHash,
      role,
      apiKeyId: apiKey.id,
      apiKeyRaw: rawKey,
      credits: dto.credits ?? null,
      parentId: parent?.id || null,
      parentEmail: parent?.email || (actorRole === 'reseller' ? actorEmail || null : null),
      parentApiKeyId: parent?.apiKeyId || actorApiKeyId || null,
      isActive: true,
    } as any);
    const saved = (await this.userRepo.save(user)) as unknown as ResellerUser;
    return { user: saved, rawKey };
  }

  async verify(email: string, password: string): Promise<{ user: ResellerUser; rawKey: string } | null> {
    const user = await this.userRepo.findOne({ where: { email: email.toLowerCase().trim(), isActive: true } });
    if (!user) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return null;
    return { user, rawKey: user.apiKeyRaw || '' };
  }

  async list(): Promise<ResellerUser[]> {
    return this.userRepo.find({ order: { createdAt: 'DESC' } });
  }

  async listForParent(parentApiKeyId: string): Promise<ResellerUser[]> {
    return this.userRepo.find({ where: { parentApiKeyId } as any, order: { createdAt: 'DESC' } });
  }

  async findByApiKeyId(apiKeyId: string): Promise<ResellerUser | null> {
    return this.userRepo.findOne({ where: { apiKeyId } as any });
  }

  async findById(id: string): Promise<ResellerUser | null> {
    return this.userRepo.findOne({ where: { id } });
  }

  async findByEmail(email: string): Promise<ResellerUser | null> {
    return this.userRepo.findOne({ where: { email: email.toLowerCase().trim() } });
  }

  async delete(id: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.apiKeyId) {
      try {
        await this.authService.delete(user.apiKeyId);
      } catch {
        // ignore delete failure
      }
    }
    await this.userRepo.remove(user);
  }

  // For AdminAuthController fallback
  async verifyResellerCredentials(
    email: string,
    password: string,
  ): Promise<{ id: string; email: string; role: string } | null> {
    const res = await this.verify(email, password);
    if (!res) return null;
    return { id: res.user.id, email: res.user.email, role: res.user.role };
  }
}
