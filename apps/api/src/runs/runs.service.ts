import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Observable, ReplaySubject } from 'rxjs';
import { HermesClient, type HermesEvent } from '../hermes/hermes.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { hermesPath, isUuid } from '../projects/workspace.js';
import { VersionsService, type VersionInfo } from '../versions/versions.service.js';

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timeout';
const ACTIVE: RunStatus[] = ['queued', 'running'];
const FINAL = new Set<RunStatus>(['completed', 'failed', 'timeout']);

/** What the browser receives for each step of a run. */
export interface RunEvent {
  type: string; // Hermes event name, or "run.status" for our own status changes
  text?: string;
  tool?: string;
  status?: RunStatus;
  version?: VersionInfo; // on "version.created"
  at: number;
}

export const FRIENDLY = {
  unavailable: "The AI builder isn't running right now. Please try again in a minute.",
  timeout: 'This took longer than 10 minutes, so it was stopped. Please try a smaller request.',
  failed: 'Something went wrong while building. Please try again.',
  noPage: 'The AI builder finished without making a page. Please try again with more detail.',
};

/** What Hermes is asked to do for a prompt (guide, Step 8). */
export function generationInput(projectId: string, prompt: string): string {
  return `Use the aba-generate-spa skill.\nWorkspace: ${hermesPath(projectId)}\nRequest: ${prompt}`;
}

interface LiveRun {
  projectId: string;
  events: ReplaySubject<RunEvent>;
}

function str(v: unknown, max = 2000): string | undefined {
  if (typeof v === 'string' && v.length) return v.length > max ? v.slice(0, max) + '…' : v;
  return undefined;
}

@Injectable()
export class RunsService implements OnModuleInit {
  private readonly logger = new Logger(RunsService.name);
  private readonly live = new Map<string, LiveRun>();
  private readonly starting = new Set<string>(); // projects with a start in progress

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly hermes: HermesClient,
    private readonly versions: VersionsService,
  ) {}

  private get timeoutMs(): number {
    return Number(process.env.RUN_TIMEOUT_MS ?? 10 * 60 * 1000);
  }

  /** Runs left "active" by a previous API process can never finish; mark them failed. */
  async onModuleInit(): Promise<void> {
    const { count } = await this.prisma.run.updateMany({
      where: { status: { in: ACTIVE } },
      data: { status: 'failed' },
    });
    if (count) this.logger.warn(`Marked ${count} interrupted run(s) as failed`);
  }

  /** Saves the run and returns at once; the Hermes run is started and followed in the background. */
  async start(userId: string, projectId: string, prompt: string): Promise<{ runId: string }> {
    const project = await this.projects.getOwned(userId, projectId);
    if (this.starting.has(project.id)) throw this.busy();
    this.starting.add(project.id);
    try {
      const busy = await this.prisma.run.findFirst({
        where: { projectId: project.id, status: { in: ACTIVE } },
      });
      if (busy) throw this.busy();
      const run = await this.prisma.run.create({
        data: { projectId: project.id, prompt, status: 'queued' },
      });
      const live: LiveRun = { projectId: project.id, events: new ReplaySubject<RunEvent>(500) };
      this.live.set(run.id, live);
      this.emit(live, { type: 'run.status', status: 'queued', text: 'Waiting for the AI builder…' });
      void this.follow(run.id, project.id, prompt, live);
      return { runId: run.id };
    } finally {
      this.starting.delete(project.id);
    }
  }

  /** The run's events for its owner: everything so far, then live ones. */
  async events(userId: string, runId: string): Promise<Observable<RunEvent>> {
    if (!isUuid(runId)) throw new NotFoundException('Run not found');
    const run = await this.prisma.run.findFirst({
      where: { id: runId, project: { ownerId: userId } },
    });
    if (!run) throw new NotFoundException('Run not found');
    const live = this.live.get(run.id);
    if (live) return live.events.asObservable();
    // Finished before this API process started (or was cleaned up): send the final status.
    return new Observable<RunEvent>((sub) => {
      sub.next({ type: 'run.status', status: run.status as RunStatus, at: Date.now() });
      sub.complete();
    });
  }

  private busy(): ConflictException {
    return new ConflictException('This project is already being built. Please wait for it to finish.');
  }

  private emit(live: LiveRun, e: Omit<RunEvent, 'at'>): void {
    live.events.next({ ...e, at: Date.now() });
  }

  private async setStatus(runId: string, live: LiveRun, status: RunStatus, text?: string) {
    await this.prisma.run.update({ where: { id: runId }, data: { status } });
    this.emit(live, { type: 'run.status', status, text });
    if (FINAL.has(status)) {
      live.events.complete();
      // Keep it a little while so a browser that connects late still sees the history.
      setTimeout(() => this.live.delete(runId), 10 * 60 * 1000).unref();
    }
  }

  private async follow(runId: string, projectId: string, prompt: string, live: LiveRun) {
    let hermesRunId: string;
    try {
      hermesRunId = await this.hermes.startRun(
        generationInput(projectId, prompt),
        `Work only inside ${hermesPath(projectId)}.`,
        projectId,
      );
    } catch (err) {
      this.logger.warn(`Run ${runId}: could not start Hermes run: ${String(err)}`);
      await this.setStatus(runId, live, 'failed', FRIENDLY.unavailable);
      return;
    }
    await this.prisma.run.update({ where: { id: runId }, data: { hermesRunId, status: 'running' } });
    this.emit(live, { type: 'run.status', status: 'running', text: 'The AI builder started working.' });

    const abort = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void this.hermes.stop(hermesRunId).catch(() => undefined);
      abort.abort();
    }, this.timeoutMs);
    timer.unref();

    let final: RunStatus | undefined;
    let finalText: string | undefined;
    try {
      for await (const e of this.hermes.events(hermesRunId, abort.signal)) {
        const outcome = await this.handle(runId, hermesRunId, live, e);
        if (outcome) {
          final = outcome.status;
          finalText = outcome.text;
          break;
        }
      }
    } catch (err) {
      if (!timedOut) this.logger.warn(`Run ${runId}: event stream ended: ${String(err)}`);
    } finally {
      clearTimeout(timer);
      abort.abort();
    }

    if (timedOut) await this.setStatus(runId, live, 'timeout', FRIENDLY.timeout);
    else if (final === 'completed') await this.finishGeneration(runId, projectId, prompt, live, finalText);
    else if (final) await this.setStatus(runId, live, final, finalText);
    else await this.setStatus(runId, live, 'failed', FRIENDLY.failed);
  }

  /** Tidy, commit and record the result as a new version, then report it. */
  private async finishGeneration(
    runId: string,
    projectId: string,
    prompt: string,
    live: LiveRun,
    finalText?: string,
  ) {
    try {
      const version = await this.versions.saveGeneration(projectId, prompt);
      if (!version) {
        await this.setStatus(runId, live, 'failed', FRIENDLY.noPage);
        return;
      }
      this.emit(live, { type: 'version.created', version, text: `Saved as version ${version.number}.` });
      await this.setStatus(runId, live, 'completed', finalText);
    } catch (err) {
      this.logger.error(`Run ${runId}: could not save the version: ${String(err)}`);
      await this.setStatus(runId, live, 'failed', FRIENDLY.failed);
    }
  }

  /** Forwards one Hermes event; returns the final status when the run is over. */
  private async handle(
    runId: string,
    hermesRunId: string,
    live: LiveRun,
    e: HermesEvent,
  ): Promise<{ status: RunStatus; text?: string } | undefined> {
    switch (e.event) {
      case 'approval.request': {
        // Hermes wants extra permissions. ABA never grants them.
        const requestId = str(e.request_id, 256);
        this.logger.warn(`Run ${runId}: denied approval request ${requestId ?? ''}`);
        await this.hermes.approve(hermesRunId, 'deny', requestId).catch(() => undefined);
        this.emit(live, { type: 'approval.denied', text: 'Denied a request for extra permissions.' });
        return;
      }
      case 'run.completed':
        return { status: 'completed', text: str(e.output) ?? 'Done.' };
      case 'run.failed':
      case 'run.cancelled':
      case 'run.interrupted':
        return { status: 'failed', text: FRIENDLY.failed };
      default:
        this.emit(live, {
          type: e.event,
          text: str(e.delta) ?? str(e.text) ?? str(e.content) ?? str(e.preview) ?? str(e.message),
          tool: str(e.tool) ?? str(e.tool_name) ?? str(e.name, 100),
        });
        return;
    }
  }
}
