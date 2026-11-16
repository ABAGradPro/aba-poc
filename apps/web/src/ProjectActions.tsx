import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, type Project } from './api'
import { Pencil, Trash } from './icons'

/** Inline rename: a text box with Save / Cancel. */
export function RenameForm({
  project,
  onDone,
  onCancel,
}: {
  project: Project
  onDone: (p: Project) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(project.name)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const id = useId()

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || name.trim() === project.name) return onCancel()
    setBusy(true)
    setError('')
    try {
      onDone(await api.renameProject(project.id, name))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.')
      setBusy(false)
    }
  }

  return (
    <form className="rename-form" onSubmit={save} onClick={(e) => e.stopPropagation()}>
      <label htmlFor={`${id}-name`} className="sr-only">
        New name for {project.name}
      </label>
      <input
        id={`${id}-name`}
        className="input input-compact"
        value={name}
        required
        maxLength={80}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      />
      <div className="row-8">
        <button type="submit" className="btn-primary compact" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn-ghost compact" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="error" role="alert">
        {error}
      </p>
    </form>
  )
}

/** "Are you sure?" dialog for deleting a project. */
export function DeleteDialog({
  project,
  onDeleted,
  onClose,
}: {
  project: Project
  onDeleted: () => void
  onClose: () => void
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
      await api.deleteProject(project.id)
      onDeleted()
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
      aria-describedby={`${id}-text`}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="stack-16">
        <span className="dialog-icon" aria-hidden="true">
          <Trash size={20} />
        </span>
        <h2 id={`${id}-title`} className="title small">
          Delete “{project.name}”?
        </h2>
        <p id={`${id}-text`} className="muted">
          Its versions and history will be removed from ABA. The project folder is moved to{' '}
          <code>~/aba-data/trash</code>, so it can still be recovered by hand.
        </p>
        <p className="error" role="alert">
          {error}
        </p>
        <div className="row-8 end">
          <button type="button" className="btn-ghost" onClick={onClose} autoFocus>
            Cancel
          </button>
          <button type="button" className="btn-danger" onClick={confirm} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete project'}
          </button>
        </div>
      </div>
    </dialog>
  )
}

/** The two small buttons shown on a card or next to a project title. */
export function ActionButtons({
  name,
  onRename,
  onDelete,
}: {
  name: string
  onRename: () => void
  onDelete: () => void
}) {
  return (
    <span className="card-actions">
      <button type="button" className="icon-btn" onClick={onRename} aria-label={`Rename ${name}`} title="Rename">
        <Pencil size={16} />
      </button>
      <button
        type="button"
        className="icon-btn danger"
        onClick={onDelete}
        aria-label={`Delete ${name}`}
        title="Delete"
      >
        <Trash size={16} />
      </button>
    </span>
  )
}
