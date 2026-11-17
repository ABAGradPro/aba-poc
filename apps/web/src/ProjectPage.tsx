import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import {
  api,
  ApiError,
  PREVIEW_ORIGIN,
  PUBLISH_BASE,
  type Project,
  type ProjectImage,
  type RunEvent,
  type RunStatus,
  type User,
  type Version,
} from './api'
import { formatDate } from './format'
import { ArrowLeft, ArrowRight, ArrowUpRight, Pencil } from './icons'
import { EditPopover, type Selection } from './EditPopover'
import { HistoryPanel } from './HistoryPanel'
import { ImagesPanel } from './ImagesPanel'
import { MessagesPanel } from './MessagesPanel'
import { PublishPanel } from './PublishPanel'
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
    case 'published':
      return { kind: 'info', text: `Live at ${e.text}` }
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
  const [history, setHistory] = useState<Version[]>([])
  const [loaded, setLoaded] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editOn, setEditOn] = useState(false)
  const [selected, setSelected] = useState<Selection | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [images, setImages] = useState<ProjectImage[]>([])
  const [askImages, setAskImages] = useState(false)
  // The page of the site that is open in the preview ("#/about"), reported by edit mode.
  const [route, setRoute] = useState('')
  const pick = useRef<HTMLInputElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const stop = useRef<() => void>(() => undefined)
  const id = useId()

  useEffect(() => () => stop.current(), [])

  // Show the newest saved version when the page opens, and keep the History list in step
  // with every new version (builds, prompt edits, drags and restores all create one).
  useEffect(() => {
    api
      .versions(project.id)
      .then((list) => {
        setHistory(list)
        setVersion((v) => (v && list[0] && v.commitSha === list[0].commitSha ? v : (list[0] ?? null)))
      })
      .catch(() => setHistory([]))
      .finally(() => setLoaded(true))
  }, [project.id, version?.commitSha])

  // The project's images; a build can add stock photos, so look again after each new version.
  useEffect(() => {
    api
      .images(project.id)
      .then(setImages)
      .catch(() => setImages([]))
  }, [project.id, version?.commitSha])

  /** Follows a run (a build, a prompt edit, a publish or a roll back) and shows its progress. */
  function follow(runId: string, onFinished?: () => void) {
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
        if (ev.type === 'run.status' && ev.status && FINAL.includes(ev.status)) {
          setRunning(false)
          onFinished?.()
        }
      },
      () => setRunning(false),
    )
  }

  /** Publish / roll back: Hermes runs the aba-publish or aba-rollback skill; then reload the project. */
  async function release(start: () => Promise<{ runId: string }>) {
    resetProgress()
    try {
      follow((await start()).runId, () => {
        api.project(project.id).then(onRenamed).catch(() => undefined)
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.')
    }
  }

  function resetProgress() {
    setError('')
    setSteps([])
    setMessage('')
  }

  // ABA asks once per project, before the first build without own images, whether to add some.
  const askedKey = `aba:asked-images:${project.id}`
  function alreadyAsked(): boolean {
    try {
      return window.localStorage.getItem(askedKey) === '1'
    } catch {
      return false // storage is blocked: ask again next time
    }
  }
  function markAsked() {
    try {
      window.localStorage.setItem(askedKey, '1')
    } catch {
      // storage is blocked: nothing to remember
    }
  }

  function start(e: FormEvent) {
    e.preventDefault()
    if (!images.some((i) => !i.stock) && !alreadyAsked()) {
      setAskImages(true)
      return
    }
    void build()
  }

  async function build() {
    setAskImages(false)
    markAsked()
    resetProgress()
    try {
      follow((await api.startRun(project.id, prompt)).runId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.')
    }
  }

  /** Click-to-edit: change the selected element by prompt (Hermes, aba-edit-element). */
  async function applyEdit(request: string) {
    if (!selected) return
    resetProgress()
    try {
      follow((await api.editElement(project.id, selected.id, request)).runId)
      setSelected(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.')
    }
  }

  /** Drag and Alt-drag: instant changes with no AI; the preview reloads with the new version. */
  async function quickEdit(label: string, change: () => Promise<Version>) {
    setEditBusy(true)
    setError('')
    try {
      const v = await change()
      setVersion(v)
      setSteps((s) => [...s, { key: Date.now(), kind: 'info', text: `${label} Saved as version ${v.number}.` }])
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.')
    } finally {
      setEditBusy(false)
    }
  }

  // Messages from edit mode inside the preview. Only accept them from that exact iframe and origin.
  useEffect(() => {
    const previewOrigin = new URL(PREVIEW_ORIGIN).origin
    function onMessage(e: MessageEvent) {
      if (e.origin !== previewOrigin || e.source !== frame.current?.contentWindow) return
      const d = e.data as Record<string, unknown> | null
      if (!d || typeof d.type !== 'string') return
      if (d.type === 'aba:ready') sendEdit()
      if (d.type === 'aba:route') {
        const hash = typeof d.hash === 'string' ? d.hash : ''
        if (/^#\/[a-z0-9-]{1,40}$/.test(hash)) setRoute(hash)
        else if (hash === '') setRoute('')
        // any other hash (an in-page anchor) keeps the last page
      }
      if (d.type === 'aba:select') {
        setSelected(typeof d.id === 'string' ? { id: d.id, label: String(d.label ?? ''), rect: d.rect as Selection['rect'] } : null)
      }
      if (d.type === 'aba:move' && typeof d.id === 'string') {
        const elementId = d.id
        void quickEdit(`Moved “${elementId}”.`, () =>
          api.moveElement(project.id, elementId, (d.parentId as string | null) ?? null, (d.beforeId as string | null) ?? null),
        )
      }
      if (d.type === 'aba:offset' && typeof d.id === 'string') {
        const elementId = d.id
        void quickEdit(`Nudged “${elementId}”.`, () =>
          api.offsetElement(project.id, elementId, Number(d.dx), Number(d.dy)),
        )
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  })

  const editActive = editOn && !running && !editBusy
  function sendEdit() {
    frame.current?.contentWindow?.postMessage({ type: 'aba:edit', on: editActive }, new URL(PREVIEW_ORIGIN).origin)
  }
  useEffect(() => {
    sendEdit()
    if (!editActive) setSelected(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editActive])
  // A new version reloads the preview, so the old selection is gone.
  useEffect(() => setSelected(null), [version?.commitSha])

  // The commit id in the URL makes the iframe load the new version after each save; the page
  // that was open (#/about) is kept, so an edit does not jump back to the home page.
  const previewUrl = version ? `${PREVIEW_ORIGIN}/p/${project.id}/?v=${version.commitSha.slice(0, 12)}${route}` : ''

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
              {askImages && (
                <div className="ask-box" role="group" aria-label="Your own images">
                  <p>
                    <strong>Do you want to add your own images?</strong> For example your logo, or photos of your
                    place and products. Without them, free stock photos are used.
                  </p>
                  <div className="row-8">
                    <button
                      type="button"
                      className="btn-primary compact"
                      onClick={() => {
                        setAskImages(false)
                        markAsked()
                        pick.current?.click()
                      }}
                    >
                      Add my images
                    </button>
                    <button type="button" className="btn-ghost compact" onClick={() => void build()}>
                      No, use stock photos
                    </button>
                  </div>
                  <p className="hint">After adding images, press “Build it” again.</p>
                </div>
              )}
              <div>
                <button type="submit" className="btn-primary" disabled={running}>
                  {running ? 'Building…' : 'Build it'}
                  {!running && <ArrowRight size={16} />}
                </button>
              </div>
            </form>

            <ImagesPanel
              projectId={project.id}
              images={images}
              disabled={running || editBusy}
              pickRef={pick}
              onChange={setImages}
            />

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

            <PublishPanel
              project={project}
              hasVersion={history.length > 0}
              disabled={running || editBusy}
              publishBase={PUBLISH_BASE}
              onPublish={(slug) => void release(() => api.publish(project.id, slug))}
              onRollback={() => void release(() => api.rollback(project.id))}
            />

            <HistoryPanel
              projectId={project.id}
              versions={history}
              disabled={running || editBusy}
              onRestored={(v) => {
                setVersion(v)
                setSteps((s) => [...s, { key: Date.now(), kind: 'info', text: `Restored: ${v.summary}. Saved as version ${v.number}.` }])
              }}
            />

            <MessagesPanel projectId={project.id} />
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
                <div className="row-8">
                  <button
                    type="button"
                    className={`btn-ghost small toggle${editOn ? ' on' : ''}`}
                    aria-pressed={editOn}
                    onClick={() => setEditOn((v) => !v)}
                    disabled={running}
                  >
                    <Pencil size={14} />
                    {editOn ? 'Editing' : 'Edit'}
                  </button>
                  <a className="btn-ghost small" href={previewUrl} target="_blank" rel="noopener noreferrer">
                    Open in new tab
                    <ArrowUpRight size={14} />
                  </a>
                </div>
              )}
            </div>
            {version && editOn && (
              <p className="edit-hint" role="status">
                {running
                  ? 'Edit mode pauses while the AI builder is working.'
                  : editBusy
                    ? 'Saving your change…'
                    : 'Click an element to change it by prompt · Drag a selected element to move it · Alt-drag to nudge it · Esc to cancel'}
              </p>
            )}
            {version ? (
              <div className="preview-stage">
                <iframe
                  ref={frame}
                  key={version.commitSha}
                  className={`preview-frame${editOn ? ' editing' : ''}`}
                  title={`Preview of ${project.name}, version ${version.number}`}
                  src={previewUrl}
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  onLoad={sendEdit}
                />
                {selected && editActive && (
                  <EditPopover
                    selection={selected}
                    bounds={{ width: frame.current?.clientWidth ?? 600, height: frame.current?.clientHeight ?? 600 }}
                    onApply={applyEdit}
                    onCancel={() => {
                      setSelected(null)
                      frame.current?.contentWindow?.postMessage({ type: 'aba:clear' }, new URL(PREVIEW_ORIGIN).origin)
                    }}
                  />
                )}
              </div>
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
