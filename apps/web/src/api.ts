export interface User {
  id: string
  username: string
}

export interface Project {
  id: string
  name: string
  createdAt: string
}

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timeout'

/** One step of a run, as streamed by GET /api/runs/:id/events. */
export interface RunEvent {
  type: string
  text?: string
  tool?: string
  status?: RunStatus
  at: number
}

/** Thrown for any non-2xx answer; `message` is safe to show the user. */
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
  if (res.status === 204) return undefined as T
  const body: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const raw = (body as { message?: string | string[] }).message
    const message = Array.isArray(raw) ? raw.join('. ') : raw
    throw new ApiError(res.status, friendly(res.status, message))
  }
  return body as T
}

function friendly(status: number, message?: string): string {
  if (status === 429) return 'Too many attempts. Please wait a minute and try again.'
  if (status >= 500) return 'Something went wrong on our side. Please try again.'
  return message ?? 'Something went wrong. Please try again.'
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

export const api = {
  me: () => call<User>('/auth/me'),
  register: (username: string, password: string) =>
    call<User>('/auth/register', json({ username, password })),
  login: (username: string, password: string) =>
    call<User>('/auth/login', json({ username, password })),
  logout: () => call<void>('/auth/logout', { method: 'POST' }),

  projects: () => call<Project[]>('/projects'),
  project: (id: string) => call<Project>(`/projects/${id}`),
  createProject: (name: string) => call<Project>('/projects', json({ name })),
  startRun: (projectId: string, prompt: string) =>
    call<{ runId: string }>(`/projects/${projectId}/runs`, json({ prompt })),

  /** Follows a run live. Returns a function that stops listening. */
  followRun(runId: string, onEvent: (e: RunEvent) => void, onEnd: () => void): () => void {
    const source = new EventSource(`/api/runs/${runId}/events`, { withCredentials: true })
    source.onmessage = (m) => onEvent(JSON.parse(m.data as string) as RunEvent)
    source.onerror = () => {
      // The server closes the stream when the run is over.
      source.close()
      onEnd()
    }
    return () => source.close()
  },
}
