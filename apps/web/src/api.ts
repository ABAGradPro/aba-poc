export interface User {
  id: string
  username: string
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

export const api = {
  me: () => call<User>('/auth/me'),
  register: (username: string, password: string) =>
    call<User>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    call<User>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => call<void>('/auth/logout', { method: 'POST' }),
}
