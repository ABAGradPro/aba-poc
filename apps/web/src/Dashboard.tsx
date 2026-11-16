import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { api, ApiError, type Project, type User } from './api'
import { ArrowRight, ArrowUpRight, Plus, Search } from './icons'
import { formatDate } from './format'
import { ActionButtons, DeleteDialog, RenameForm } from './ProjectActions'
import { TopBar } from './TopBar'

interface Props {
  user: User
  onLogout: () => void
  onOpen: (project: Project) => void
}

export function Dashboard({ user, onLogout, onOpen }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Project | null>(null)
  const id = useId()

  useEffect(() => {
    api
      .projects()
      .then(setProjects)
      .catch(() => setError('Could not load your projects.'))
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (projects ?? []).filter((p) => !q || p.name.toLowerCase().includes(q))
  }, [projects, query])

  async function create(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
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
    <div className="page">
      <TopBar user={user} onLogout={onLogout} />
      <main className="container">
        <section className="stack-24">
          <div className="stack-8">
            <h1 className="display">Your projects</h1>
            <p className="lead">Describe an app, give it a name, and let the agent build it.</p>
          </div>

          <form className="panel-form" onSubmit={create}>
            <label htmlFor={`${id}-name`} className="sr-only">
              New project name
            </label>
            <div className="input-icon grow">
              <Plus size={18} className="input-glyph" />
              <input
                id={`${id}-name`}
                className="input input-inset"
                placeholder="New project name, e.g. Coffee shop"
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Creating…' : 'New project'}
              <ArrowRight size={16} />
            </button>
          </form>
          <p className="error" role="alert">
            {error}
          </p>
        </section>

        <section className="stack-16">
          <div className="section-head">
            <h2 className="eyebrow">
              All projects <span className="eyebrow-count">· {projects?.length ?? 0}</span>
            </h2>
            <div className="input-icon search">
              <label htmlFor={`${id}-search`} className="sr-only">
                Search projects
              </label>
              <Search size={16} className="input-glyph small" />
              <input
                id={`${id}-search`}
                type="search"
                className="input input-search"
                placeholder="Search projects"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          {projects === null ? (
            <p className="empty">Loading…</p>
          ) : projects.length === 0 ? (
            <p className="empty">You have no projects yet. Give your first one a name above.</p>
          ) : shown.length === 0 ? (
            <p className="empty">No projects match your search.</p>
          ) : (
            <ul className="card-grid">
              {shown.map((p) => (
                <li key={p.id} className="card-cell">
                  {renaming === p.id ? (
                    <div className="project-card editing">
                      <RenameForm
                        project={p}
                        onCancel={() => setRenaming(null)}
                        onDone={(updated) => {
                          setProjects((all) => all?.map((x) => (x.id === updated.id ? updated : x)) ?? null)
                          setRenaming(null)
                        }}
                      />
                    </div>
                  ) : (
                    <>
                      <button type="button" className="project-card" onClick={() => onOpen(p)}>
                        <span className="card-top">
                          <span className="initial" aria-hidden="true">
                            {p.name.charAt(0).toUpperCase()}
                          </span>
                          <ArrowUpRight size={18} className="card-arrow" />
                        </span>
                        <span className="card-body">
                          <span className="card-name">{p.name}</span>
                          <span className="card-meta">Created {formatDate(p.createdAt)}</span>
                        </span>
                      </button>
                      <ActionButtons name={p.name} onRename={() => setRenaming(p.id)} onDelete={() => setDeleting(p)} />
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      {deleting && (
        <DeleteDialog
          project={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setProjects((all) => all?.filter((x) => x.id !== deleting.id) ?? null)
            setDeleting(null)
          }}
        />
      )}
    </div>
  )
}
