import { Injectable } from '@nestjs/common';
import { SseParser } from './sse.js';

/** One event from Hermes' run stream, e.g. { event: "tool.started", run_id, ... }. */
export type HermesEvent = { event: string; [key: string]: unknown };

/** Hermes could not be reached or refused the request. */
export class HermesUnavailableError extends Error {}

/** Talks to the Hermes Runs API (POST /v1/runs, its event stream, approval and stop). */
@Injectable()
export class HermesClient {
  private get base(): string {
    return process.env.HERMES_URL ?? 'http://127.0.0.1:8642';
  }

  private headers(): Record<string, string> {
    const key = process.env.HERMES_API_KEY;
    if (!key) throw new HermesUnavailableError('HERMES_API_KEY is not set');
    return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  }

  private async post(path: string, body: unknown, timeoutMs = 5000): Promise<Response> {
    try {
      return await fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new HermesUnavailableError(`Hermes is not reachable: ${String(err)}`);
    }
  }

  /** Starts a run and returns Hermes' run id. */
  async startRun(input: string, instructions: string, sessionId: string): Promise<string> {
    const res = await this.post('/v1/runs', {
      input,
      instructions,
      session_id: sessionId,
    });
    if (!res.ok) {
      throw new HermesUnavailableError(`Hermes refused the run (HTTP ${res.status})`);
    }
    const body = (await res.json()) as { run_id?: string };
    if (!body.run_id) throw new HermesUnavailableError('Hermes returned no run id');
    return body.run_id;
  }

  /** Yields the run's events until Hermes closes the stream or `signal` aborts. */
  async *events(runId: string, signal: AbortSignal): AsyncGenerator<HermesEvent> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/v1/runs/${encodeURIComponent(runId)}/events`, {
        headers: { ...this.headers(), Accept: 'text/event-stream' },
        signal,
      });
    } catch (err) {
      throw new HermesUnavailableError(`Hermes event stream failed: ${String(err)}`);
    }
    if (!res.ok || !res.body) {
      throw new HermesUnavailableError(`Hermes event stream failed (HTTP ${res.status})`);
    }
    const parser = new SseParser();
    const decoder = new TextDecoder();
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      for (const payload of parser.push(decoder.decode(chunk, { stream: true }))) {
        if (payload && typeof (payload as HermesEvent).event === 'string') {
          yield payload as HermesEvent;
        }
      }
    }
  }

  async approve(runId: string, choice: 'deny' | 'once', requestId?: string): Promise<void> {
    await this.post(`/v1/runs/${encodeURIComponent(runId)}/approval`, {
      choice,
      ...(requestId ? { request_id: requestId } : {}),
    });
  }

  async stop(runId: string): Promise<void> {
    await this.post(`/v1/runs/${encodeURIComponent(runId)}/stop`, {});
  }
}
