import { useEffect, useId, useRef, useState } from 'react'
import { api, ApiError, type Version } from './api'

const KIND_LABEL: Record<string, string> = {
  generate: 'Build',
  edit: 'Edit',
  move: 'Move',
  offset: 'Nudge',
  restore: 'Restore',
}

const time = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { hour12: true, day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' })

/** The last three versions with a Restore button (guide, Step 10). */
export function HistoryPanel({
  projectId,
  versions,
  disabled,
  onRestored,
}: {
  projectId: string
  versions: Version[]
  disabled: boolean
  onRestored: (v: Version) => void
}) {
  const [confirming, setConfirming] = useState<Version | null>(null)
  const id = useId()

  return (
    <section aria-labelledby={`${id}-history`} className="panel stack-16">
      <div className="history-head">
        <h2 id={`${id}-history`} className="eyebrow">
          History
        </h2>
        <span className="muted small-note">Last {versions.length || 3} versions · every change is kept in git</span>
      </div>
      {versions.length === 0 ? (
        <p className="muted">No versions yet. Each build or edit will appear here.</p>
      ) : (
        <ol className="history">
          {versions.map((v, i) => (
            <li key={v.id} className={`history-item${i === 0 ? ' current' : ''}`}>
              <div className="history-main">
                <span className="history-title">
                  Version {v.number}
                  <span className={`kind kind-${v.kind}`}>{KIND_LABEL[v.kind] ?? v.kind}</span>
                  {i === 0 && <span className="current-badge">Current</span>}
                </span>
                <span className="history-summary" title={v.summary}>
                  {v.summary}
                </span>
                <span className="history-time">{time(v.createdAt)}</span>
              </div>
              {i > 0 && (
                <button
                  type="button"
                  className="btn-ghost compact"
                  disabled={disabled}
                  onClick={() => setConfirming(v)}
                  aria-label={`Restore version ${v.number}`}
                >
                  Restore
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {confirming && (
        <RestoreDialog
          projectId={projectId}
          version={confirming}
          current={versions[0]}
          onClose={() => setConfirming(null)}
          onRestored={(v) => {
            setConfirming(null)
            onRestored(v)
          }}
        />
      )}
    </section>
  )
}

function RestoreDialog({
  projectId,
  version,
  current,
  onClose,
  onRestored,
}: {
  projectId: string
  version: Version
  current: Version
  onClose: () => void
  onRestored: (v: Version) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const id = useId()

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      onRestored(await api.restoreVersion(projectId, version.id))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.')
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="stack-16">
        <h2 id={`${id}-title`} className="title small">
          Go back to version {version.number}?
        </h2>
        <p className="muted">
          The app will look exactly like it did in version {version.number} ({version.summary}). Your current version{' '}
          {current.number} stays in history, so you can undo this.
        </p>
        <p className="error" role="alert">
          {error}
        </p>
        <div className="row-8 end">
          <button type="button" className="btn-ghost" onClick={onClose} autoFocus>
            Cancel
          </button>
          <button type="button" className="btn-primary compact" onClick={confirm} disabled={busy}>
            {busy ? 'Restoring…' : `Restore version ${version.number}`}
          </button>
        </div>
      </div>
    </dialog>
  )
}
