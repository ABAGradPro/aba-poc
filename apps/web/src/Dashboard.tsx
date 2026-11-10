import { useEffect, useId, useState, type FormEvent } from 'react'
import { api, ApiError, type Project, type User } from './api'

interface Props {
  user: User
  onLogout: () => void
  onOpen: (project: Project) => void
}

export function TopBar({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <header className="topbar">
      <span className="brand">ABA</span>
      <span>
        Signed in as <strong>{user.username}</strong>{' '}
        <button type="button" onClick={onLogout}>
          Log out
        </button>
      </span>
    </header>
  )
}

export function Dashboard({ user, onLogout, onOpen }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const id = useId()

  useEffect(() => {
    api
      .projects()
      .then(setProjects)
      .catch(() => setError('Could not load your projects.'))
  }, [])

  async function create(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      onOpen(await api.createProject(name))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.')
      setBusy(false)
    }
  }

  return (
    <>
      <TopBar user={user} onLogout={onLogout} />
      <main className="card wide">
        <h1>Your projects</h1>

        <form className="row" onSubmit={create}>
          <label htmlFor={`${id}-name`} className="sr-only">
            New project name
          </label>
          <input
            id={`${id}-name`}
            placeholder="New project name, e.g. Coffee shop"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'New project'}
          </button>
        </form>
        <p className="error" role="alert">
          {error}
        </p>

        {projects === null ? (
          <p>Loading…</p>
        ) : projects.length === 0 ? (
          <p>You have no projects yet. Give your first one a name above.</p>
        ) : (
          <ul className="projects">
            {projects.map((p) => (
              <li key={p.id}>
                <button type="button" className="link" onClick={() => onOpen(p)}>
                  {p.name}
                </button>
                <span className="muted"> · created {new Date(p.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}
