import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import {
  api,
  ApiError,
  PREVIEW_ORIGIN,
  type Project,
  type RunEvent,
  type RunStatus,
  type User,
  type Version,
} from './api'
import { formatDate } from './format'
import { ArrowLeft, ArrowRight, ArrowUpRight } from './icons'
import { ActionButtons, DeleteDialog, RenameForm } from './ProjectActions'
import { TopBar } from './TopBar'

interface Props {
  user: User
  project: Project
  onLogout: () => void
  onBack: () => void
  onRenamed: (project: Project) => void
}

interface Step {
  key: number
  text: string
  kind: 'info' | 'tool' | 'message' | 'done' | 'error'
}

const FINAL: RunStatus[] = ['completed', 'failed', 'timeout']

/** Turns raw run events into short lines a non-technical user can follow. */
function describe(e: RunEvent): Omit<Step, 'key'> | null {
  switch (e.type) {
    case 'run.status':
      // The reply itself is shown once, in the box below the list.
      if (e.status === 'completed') return { kind: 'done', text: 'Done ✓' }
      if (e.status === 'failed' || e.status === 'timeout')
        return { kind: 'error', text: e.text ?? 'Something went wrong.' }
      return e.text ? { kind: 'info', text: e.text } : null
    case 'tool.started':
      return { kind: 'tool', text: `Working: ${e.tool ?? 'a tool'}…` }
    case 'tool.failed':
      return { kind: 'tool', text: `A step did not work (${e.tool ?? 'tool'}); trying another way.` }
    case 'approval.denied':
      return { kind: 'info', text: e.text ?? 'Denied a request for extra permissions.' }
    case 'version.created':
      return { kind: 'info', text: e.text ?? 'Saved a new version.' }
    default:
      return null
  }
}

export function ProjectPage({ user, project, onLogout, onBack, onRenamed }: Props) {
  const [prompt, setPrompt] = useState('')
  const [steps, setSteps] = useState<Step[]>([])
  const [message, setMessage] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [version, setVersion] = useState<Version | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const stop = useRef<() => void>(() => undefined)
  const id = useId()

  useEffect(() => () => stop.current(), [])

  // Show the newest saved version when the page opens.
  useEffect(() => {
    api
      .versions(project.id)
      .then((list) => setVersion(list[0] ?? null))
      .catch(() => setVersion(null))
      .finally(() => setLoaded(true))
  }, [project.id])

  async function start(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSteps([])
    setMessage('')
    try {
      const { runId } = await api.startRun(project.id, prompt)
      setRunning(true)
      let n = 0
      stop.current = api.followRun(
        runId,
        (ev) => {
          if (ev.type === 'message.delta' && ev.text) {
            setMessage((m) => m + ev.text)
            return
          }
          if (ev.type === 'version.created' && ev.version) setVersion(ev.version)
          // If no text was streamed, use the final summary as the reply.
          if (ev.type === 'run.status' && ev.status === 'completed' && ev.text) {
            setMessage((m) => m || ev.text!)
          }
          const step = describe(ev)
          if (step) setSteps((s) => [...s, { ...step, key: n++ }])
          if (ev.type === 'run.status' && ev.status && FINAL.includes(ev.status)) setRunning(false)
        },
        () => setRunning(false),
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.')
    }
  }

  // The commit id in the URL makes the iframe load the new version after each save.
  const previewUrl = version ? `${PREVIEW_ORIGIN}/p/${project.id}/?v=${version.commitSha.slice(0, 12)}` : ''

  return (
    <div className="page">
      <TopBar user={user} onLogout={onLogout} />
      <main className="container workspace">
        <div className="stack-8">
          <button type="button" className="btn-link back" onClick={onBack}>
            <ArrowLeft size={16} />
            All projects
          </button>
          {renaming ? (
            <RenameForm
              project={project}
              onCancel={() => setRenaming(false)}
              onDone={(p) => {
                onRenamed(p)
                setRenaming(false)
              }}
            />
          ) : (
            <div className="title-row">
              <h1 className="display">{project.name}</h1>
              {!running && (
                <ActionButtons name={project.name} onRename={() => setRenaming(true)} onDelete={() => setDeleting(true)} />
              )}
            </div>
          )}
          <p className="lead">Created {formatDate(project.createdAt)}</p>
        </div>

        <div className="split">
          <div className="stack-24 split-left">
            <form className="panel stack-form" onSubmit={start}>
              <div className="field">
                <label htmlFor={`${id}-prompt`}>Describe the app you want</label>
                <textarea
                  id={`${id}-prompt`}
                  className="input textarea"
                  rows={4}
                  required
                  maxLength={4000}
                  placeholder="A landing page for a coffee shop in Amman with a menu and a contact form"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>
              <p className="error" role="alert">
                {error}
              </p>
              <div>
                <button type="submit" className="btn-primary" disabled={running}>
                  {running ? 'Building…' : 'Build it'}
                  {!running && <ArrowRight size={16} />}
                </button>
              </div>
            </form>

            <section aria-labelledby={`${id}-progress`} className="panel stack-16">
              <h2 id={`${id}-progress`} className="eyebrow">
                Progress
              </h2>
              {steps.length === 0 && !running ? (
                <p className="muted">Nothing yet. Describe your app and press “Build it”.</p>
              ) : (
                <ol className="steps" aria-live="polite">
                  {steps.map((s) => (
                    <li key={s.key} className={`step ${s.kind}`}>
                      {s.text}
                    </li>
                  ))}
                </ol>
              )}
              {message.trim() && (
                <p className="reply" aria-live="polite">
                  {message.trim()}
                </p>
              )}
            </section>
          </div>

          <section aria-labelledby={`${id}-preview`} className="panel preview-panel">
            <div className="preview-head">
              <div className="stack-4">
                <h2 id={`${id}-preview`} className="eyebrow">
                  Preview
                </h2>
                {version && (
                  <p className="preview-version">
                    <span className="version-badge">Version {version.number}</span>
                    <span className="muted truncate">{version.summary}</span>
                  </p>
                )}
              </div>
              {version && (
                <a className="btn-ghost small" href={previewUrl} target="_blank" rel="noopener noreferrer">
                  Open in new tab
                  <ArrowUpRight size={14} />
                </a>
              )}
            </div>
            {version ? (
              <iframe
                key={version.commitSha}
                className="preview-frame"
                title={`Preview of ${project.name}, version ${version.number}`}
                src={previewUrl}
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            ) : (
              <div className="preview-empty">
                <p className="muted">
                  {loaded
                    ? running
                      ? 'Your app will appear here when it is ready.'
                      : 'No version yet. Describe your app and press “Build it”.'
                    : 'Loading…'}
                </p>
              </div>
            )}
          </section>
        </div>
      </main>
      {deleting && <DeleteDialog project={project} onClose={() => setDeleting(false)} onDeleted={onBack} />}
    </div>
  )
}
