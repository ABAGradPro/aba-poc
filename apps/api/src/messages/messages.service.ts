import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { isUuid } from '../projects/workspace.js';

/** Limits, so a broken or looping page cannot fill the database. */
export const MAX_FIELDS = 20;
export const MAX_FIELD_CHARS = 2000;
export const MAX_PER_HOUR = 60;
export const KEEP_MESSAGES = 200;

export interface MessageInfo {
  id: string;
  name: string;
  contact: string;
  message: string;
  /** Any other fields the form had (date, guests, ...). */
  fields: Record<string, string>;
  createdAt: Date;
}

export type SaveResult = 'saved' | 'invalid' | 'too-many' | 'no-project';

/**
 * Turns whatever a generated form sent into safe text fields: at most 20 short keys with
 * string values. Returns null when there is nothing usable.
 */
export function cleanFields(body: unknown): Record<string, string> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>).slice(0, MAX_FIELDS)) {
    if (!/^[\w .-]{1,40}$/.test(key)) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    const text = String(value).trim().slice(0, MAX_FIELD_CHARS);
    if (text) out[key] = text;
  }
  return Object.keys(out).length ? out : null;
}

const pick = (fields: Record<string, string>, names: string[]): string => {
  for (const [key, value] of Object.entries(fields)) {
    if (names.includes(key.toLowerCase())) return value;
  }
  return '';
};

/** What visitors sent through the contact forms of a project's preview. */
@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  /** Called by the preview server (no login: the sender is a visitor of the generated page). */
  async save(projectId: string, body: unknown): Promise<SaveResult> {
    if (!isUuid(projectId)) return 'no-project';
    const fields = cleanFields(body);
    if (!fields) return 'invalid';
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) return 'no-project';
    const recent = await this.prisma.message.count({
      where: { projectId, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    if (recent >= MAX_PER_HOUR) return 'too-many';

    const name = pick(fields, ['name', 'fullname', 'full_name', 'full-name', 'your-name']);
    const contact = [pick(fields, ['email', 'e-mail', 'mail']), pick(fields, ['phone', 'tel', 'telephone', 'mobile'])]
      .filter(Boolean)
      .join(' · ');
    const message = pick(fields, ['message', 'msg', 'comment', 'comments', 'notes', 'note', 'details']);
    await this.prisma.message.create({
      data: { projectId, name: name.slice(0, 200), contact: contact.slice(0, 300), message, fields },
    });
    // Keep only the newest ones.
    const old = await this.prisma.message.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      skip: KEEP_MESSAGES,
      select: { id: true },
    });
    if (old.length) await this.prisma.message.deleteMany({ where: { id: { in: old.map((m) => m.id) } } });
    return 'saved';
  }

  async list(userId: string, projectId: string): Promise<MessageInfo[]> {
    const project = await this.projects.getOwned(userId, projectId);
    const rows = await this.prisma.message.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      take: KEEP_MESSAGES,
    });
    return rows.map((m) => ({
      id: m.id,
      name: m.name,
      contact: m.contact,
      message: m.message,
      fields: (m.fields ?? {}) as Record<string, string>,
      createdAt: m.createdAt,
    }));
  }

  async remove(userId: string, projectId: string, messageId: string): Promise<void> {
    const project = await this.projects.getOwned(userId, projectId);
    if (!isUuid(messageId)) throw new NotFoundException('Message not found');
    const { count } = await this.prisma.message.deleteMany({ where: { id: messageId, projectId: project.id } });
    if (!count) throw new NotFoundException('Message not found');
  }
}
