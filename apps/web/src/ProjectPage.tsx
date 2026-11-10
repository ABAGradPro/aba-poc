import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, type Project, type RunEvent, type RunStatus, type User } from './api'
import { TopBar } from './Dashboard'

interface Props {
  user: User
  project: Project
  onLogout: () => void
  onBack: () => void
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
    default:
      return null
  }
}

export function ProjectPage({ user, project, onLogout, onBack }: Props) {
  const [prompt, setPrompt] = useState('')
  const [steps, setSteps] = useState<Step[]>([])
  const [message, setMessage] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const stop = useRef<() => void>(() => undefined)
  const id = useId()

  useEffect(() => () => stop.current(), [])

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

  return (
    <>
      <TopBar user={user} onLogout={onLogout} />
      <main className="card wide">
        <button type="button" className="link" onClick={onBack}>
          ← All projects
        </button>
        <h1>{project.name}</h1>

        <form onSubmit={start}>
          <label htmlFor={`${id}-prompt`}>Describe the app you want</label>
          <textarea
            id={`${id}-prompt`}
            rows={4}
            required
            maxLength={4000}
            placeholder="A landing page for a coffee shop in Amman with a menu and a contact form"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <p className="error" role="alert">
            {error}
          </p>
          <button type="submit" disabled={running}>
            {running ? 'Building…' : 'Build it'}
          </button>
        </form>

        <section aria-labelledby={`${id}-progress`} className="progress">
          <h2 id={`${id}-progress`}>Progress</h2>
          {steps.length === 0 && !running ? (
            <p className="muted">Nothing yet. Describe your app and press “Build it”.</p>
          ) : (
            <ol aria-live="polite">
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
      </main>
    </>
  )
}
