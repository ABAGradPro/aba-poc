import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Observable, ReplaySubject } from 'rxjs';
import { simpleGit } from 'simple-git';
import { EditError, extractElement, parseEditReply, replaceElement } from '../edits/html-edits.js';
import type { Project } from '../generated/prisma/client.js';
import { HermesClient, type HermesEvent } from '../hermes/hermes.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { hermesPath, hostPath, isUuid } from '../projects/workspace.js';
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
  badEdit: "The AI's answer could not be used, so nothing was changed. Please try again or describe the change differently.",
  notLive: 'The page could not be confirmed live on the server, so it was not marked as published.',
};

/** Where published apps are served (the management droplet's Nginx, Step 2). */
export function publishBase(): string {
  return (process.env.PUBLISH_BASE_URL ?? 'http://157.230.117.76').replace(/\/+$/, '');
}

/** What Hermes is asked to do to publish or roll back (guide, Step 11). */
export function publishInput(folder: string, slug: string): string {
  return `Use the aba-publish skill. Workspace: ${hermesPath(folder)}. Slug: ${slug}.`;
}
export function rollbackInput(slug: string): string {
  return `Use the aba-rollback skill. Slug: ${slug}.`;
}

const RELEASE_INSTRUCTIONS =
  'Follow the skill exactly. Do not create, change or delete any files in the workspace. Finish with one short sentence for a non-technical user.';

/** What Hermes is asked to do for a prompt (guide, Step 8). */
export function generationInput(folder: string, prompt: string): string {
  return `Use the aba-generate-spa skill.\nWorkspace: ${hermesPath(folder)}\nRequest: ${prompt}`;
}

/** What Hermes is asked to do to change one element (guide, Step 9). */
export function editInput(elementHtml: string, stylesCss: string, request: string): string {
  return [
    'Use the aba-edit-element skill.',
    'Element:',
    elementHtml,
    '',
    'Current styles.css (for reference only; do not repeat it):',
    stylesCss || '(empty)',
    '',
    `Request: ${request}`,
  ].join('\n');
}

const EDIT_INSTRUCTIONS =
  'This is an edit of one element. Do not create, change or delete any files. Reply only with the JSON object.';

interface LiveRun {
  projectId: string;
  events: ReplaySubject<RunEvent>;
}

/** One kind of Hermes job: how to ask, and what to do with the answer. */
interface Job {
  input: string;
  instructions: string;
  sessionId: string;
  /** Called once Hermes reports run.completed, with its full final answer. */
  finish: (runId: string, live: LiveRun, output: string, summary: string | undefined) => Promise<void>;
}

function str(v: unknown, max = 2000): string | undefined {
  if (typeof v === 'string' && v.length) return v.length > max ? v.slice(0, max) + '…' : v;
  return undefined;
}

const short = (s: string, max = 60) => {
  const one = s.trim().replace(/\s+/g, ' ');
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
};

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

  /** Build (or rebuild) the app from a prompt. Answers at once; Hermes runs in the background. */
  async start(userId: string, projectId: string, prompt: string): Promise<{ runId: string }> {
    const project = await this.projects.getOwned(userId, projectId);
    return this.launch(project, prompt, () => ({
      input: generationInput(project.folder, prompt),
      instructions: `Work only inside ${hermesPath(project.folder)}.`,
      sessionId: project.id,
      finish: (id, live, _output, summary) => this.finishGeneration(id, project, prompt, live, summary),
    }));
  }

  /** Change one element by prompt with the aba-edit-element skill (guide, Step 9). */
  async startEdit(
    userId: string,
    projectId: string,
    elementId: string,
    request: string,
  ): Promise<{ runId: string }> {
    const project = await this.projects.getOwned(userId, projectId);
    // "Busy" comes first: a build in progress may be rewriting the page right now.
    await this.projects.assertIdle(project.id, 'edited');
    const dir = hostPath(project.folder);
    const page = await readFile(path.join(dir, 'index.html'), 'utf8').catch(() => null);
    if (page === null) throw new BadRequestException('Build the app first, then edit it.');
    const element = extractElement(page, elementId);
    if (!element) throw new NotFoundException('That element no longer exists. Reload the preview and try again.');
    const styles = (await readFile(path.join(dir, 'styles.css'), 'utf8').catch(() => '')).slice(0, 8000);

    return this.launch(project, `edit ${elementId}: ${request}`, (runId) => ({
      input: editInput(element, styles, request),
      instructions: EDIT_INSTRUCTIONS,
      sessionId: `${project.id}-edit-${runId}`, // a fresh conversation for each edit
      finish: (id, live, output) => this.finishEdit(id, project, elementId, live, output),
    }));
  }

  /** Publish the current version to the droplet with the aba-publish skill (guide, Step 11). */
  async startPublish(userId: string, projectId: string, slug: string): Promise<{ runId: string }> {
    const project = await this.projects.getOwned(userId, projectId);
    await this.projects.assertIdle(project.id, 'published');
    const taken = await this.prisma.project.findFirst({ where: { slug, NOT: { id: project.id } } });
    if (taken) throw new ConflictException('That address is already used by another project. Please choose another.');
    const page = await readFile(path.join(hostPath(project.folder), 'index.html'), 'utf8').catch(() => null);
    if (page === null) throw new BadRequestException('Build the app first, then publish it.');
    return this.launch(project, `publish ${slug}`, (runId) => ({
      input: publishInput(project.folder, slug),
      instructions: RELEASE_INSTRUCTIONS,
      sessionId: `${project.id}-publish-${runId}`,
      finish: (id, live, output) => this.finishPublish(id, project, slug, live, output),
    }));
  }

  /** Point the live address back at the previous release with the aba-rollback skill. */
  async startRollback(userId: string, projectId: string): Promise<{ runId: string }> {
    const project = await this.projects.getOwned(userId, projectId);
    if (!project.slug) throw new BadRequestException('Publish the app first; then you can roll back.');
    const slug = project.slug;
    return this.launch(project, `rollback ${slug}`, (runId) => ({
      input: rollbackInput(slug),
      instructions: RELEASE_INSTRUCTIONS,
      sessionId: `${project.id}-rollback-${runId}`,
      finish: (id, live, output) => this.finishRollback(id, project, slug, live, output),
    }));
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

  /** Saves the run (409 if the project is busy) and follows the Hermes job in the background. */
  private async launch(
    project: Project,
    prompt: string,
    jobFor: (runId: string) => Job,
  ): Promise<{ runId: string }> {
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
      void this.follow(run.id, live, jobFor(run.id));
      return { runId: run.id };
    } finally {
      this.starting.delete(project.id);
    }
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

  private async follow(runId: string, live: LiveRun, job: Job) {
    let hermesRunId: string;
    try {
      hermesRunId = await this.hermes.startRun(job.input, job.instructions, job.sessionId);
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

    let outcome: { status: RunStatus; text?: string; output: string } | undefined;
    try {
      for await (const e of this.hermes.events(hermesRunId, abort.signal)) {
        outcome = await this.handle(runId, hermesRunId, live, e);
        if (outcome) break;
      }
    } catch (err) {
      if (!timedOut) this.logger.warn(`Run ${runId}: event stream ended: ${String(err)}`);
    } finally {
      clearTimeout(timer);
      abort.abort();
    }

    if (timedOut) await this.setStatus(runId, live, 'timeout', FRIENDLY.timeout);
    else if (outcome?.status === 'completed') await job.finish(runId, live, outcome.output, outcome.text);
    else if (outcome) await this.setStatus(runId, live, outcome.status, outcome.text);
    else await this.setStatus(runId, live, 'failed', FRIENDLY.failed);
  }

  /** After a build: tidy, commit and record the result as a new version, then report it. */
  private async finishGeneration(
    runId: string,
    project: Project,
    prompt: string,
    live: LiveRun,
    summary?: string,
  ) {
    try {
      const version = await this.versions.saveGeneration(project.id, project.folder, prompt);
      if (!version) {
        await this.setStatus(runId, live, 'failed', FRIENDLY.noPage);
        return;
      }
      this.emit(live, { type: 'version.created', version, text: `Saved as version ${version.number}.` });
      await this.setStatus(runId, live, 'completed', summary);
    } catch (err) {
      this.logger.error(`Run ${runId}: could not save the version: ${String(err)}`);
      await this.setStatus(runId, live, 'failed', FRIENDLY.failed);
    }
  }

  /**
   * After an element edit: throw away any file Hermes may have touched, check its JSON answer,
   * replace just that element, append the CSS to styles.css and commit "edit: <id>".
   * An answer that fails the check changes nothing.
   */
  private async finishEdit(runId: string, project: Project, elementId: string, live: LiveRun, output: string) {
    const dir = hostPath(project.folder);
    try {
      const git = simpleGit(dir);
      await git.reset(['--hard', 'HEAD']);
      await git.clean('f', ['-d']);

      let reply: { html: string; css: string };
      try {
        reply = parseEditReply(output, elementId);
      } catch (err) {
        this.logger.warn(`Run ${runId}: unusable edit answer: ${String(err)}`);
        await this.setStatus(runId, live, 'failed', FRIENDLY.badEdit);
        return;
      }

      const index = path.join(dir, 'index.html');
      await writeFile(index, replaceElement(await readFile(index, 'utf8'), elementId, reply.html));
      if (reply.css) {
        const styles = path.join(dir, 'styles.css');
        const before = await readFile(styles, 'utf8').catch(() => '');
        await writeFile(styles, `${before.replace(/\s*$/, '')}\n\n/* edit: ${elementId} */\n${reply.css}\n`);
      }
      const version = await this.versions.commitChange(project.id, project.folder, 'edit', `edit: ${elementId}`);
      this.emit(live, { type: 'version.created', version, text: `Saved as version ${version.number}.` });
      await this.setStatus(runId, live, 'completed', `Changed “${short(elementId)}”.`);
    } catch (err) {
      const message = err instanceof EditError ? err.message : FRIENDLY.failed;
      this.logger.error(`Run ${runId}: could not apply the edit: ${String(err)}`);
      await this.setStatus(runId, live, 'failed', message);
    }
  }

  /** Fetches the live page; returns its HTML, or null if it is not served. */
  private async fetchLive(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'Cache-Control': 'no-cache' } });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  }

  /**
   * After a publish run: the API checks for itself that the live page is exactly this
   * project's index.html before it records the address. Hermes' own words explain a refusal
   * (for example aba-verify failing).
   */
  private async finishPublish(runId: string, project: Project, slug: string, live: LiveRun, output: string) {
    const url = `${publishBase()}/${slug}/`;
    const local = await readFile(path.join(hostPath(project.folder), 'index.html'), 'utf8').catch(() => '');
    const served = await this.fetchLive(url);
    if (served === null || served !== local) {
      this.logger.warn(`Run ${runId}: ${url} is ${served === null ? 'not served' : 'not this version'}`);
      const why = output.trim() ? `Not published: ${short(output, 400)}` : FRIENDLY.notLive;
      await this.setStatus(runId, live, 'failed', why);
      return;
    }
    await this.prisma.project.update({
      where: { id: project.id },
      data: { slug, liveUrl: url, publishedAt: new Date() },
    });
    this.emit(live, { type: 'published', text: url });
    await this.setStatus(runId, live, 'completed', `Your app is live at ${url}`);
  }

  /** After a rollback run: confirm the address still serves a page. */
  private async finishRollback(runId: string, project: Project, slug: string, live: LiveRun, output: string) {
    const url = `${publishBase()}/${slug}/`;
    if ((await this.fetchLive(url)) === null) {
      await this.setStatus(runId, live, 'failed', output.trim() ? short(output, 400) : FRIENDLY.notLive);
      return;
    }
    // The skill stops when there is nothing to go back to; Hermes then says so.
    const failedWords = /no previous release|nothing to roll back|cannot roll back|could not roll back|rollback failed/i;
    if (failedWords.test(output)) {
      await this.setStatus(runId, live, 'failed', short(output, 400));
      return;
    }
    await this.prisma.project.update({ where: { id: project.id }, data: { publishedAt: new Date() } });
    this.emit(live, { type: 'published', text: url });
    await this.setStatus(runId, live, 'completed', `The previous version is live again at ${url}`);
  }

  /** Forwards one Hermes event; returns the outcome when the run is over. */
  private async handle(
    runId: string,
    hermesRunId: string,
    live: LiveRun,
    e: HermesEvent,
  ): Promise<{ status: RunStatus; text?: string; output: string } | undefined> {
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
        return {
          status: 'completed',
          text: str(e.output) ?? 'Done.',
          output: typeof e.output === 'string' ? e.output : '',
        };
      case 'run.failed':
      case 'run.cancelled':
      case 'run.interrupted':
        return { status: 'failed', text: FRIENDLY.failed, output: '' };
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
