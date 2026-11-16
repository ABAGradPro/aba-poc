import { useId, useState, type FormEvent } from 'react'
import { ArrowRight } from './icons'

/** What edit mode reported when the user clicked an element in the preview. */
export interface Selection {
  id: string
  label: string
  rect: { x: number; y: number; width: number; height: number }
}

const WIDTH = 320
const HEIGHT = 190

/** The small "change this element" box shown next to the selected element. */
export function EditPopover({
  selection,
  bounds,
  onApply,
  onCancel,
}: {
  selection: Selection
  /** Size of the preview frame, so the box always stays inside it. */
  bounds: { width: number; height: number }
  onApply: (request: string) => void
  onCancel: () => void
}) {
  const [request, setRequest] = useState('')
  const id = useId()
  const { x, y, height } = selection.rect

  // Below the element if there is room, otherwise above it; never outside the preview.
  const below = y + height + 10
  const top = Math.max(8, Math.min(below + HEIGHT <= bounds.height ? below : y - HEIGHT - 10, bounds.height - HEIGHT))
  const left = Math.max(8, Math.min(x, bounds.width - WIDTH - 8))

  function submit(e: FormEvent) {
    e.preventDefault()
    if (request.trim()) onApply(request.trim())
  }

  return (
    <form
      className="edit-popover"
      style={{ top, left, maxWidth: WIDTH }}
      onSubmit={submit}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      aria-label={`Change element ${selection.id}`}
    >
      <p className="edit-target">
        Changing <code>{selection.id}</code>
        {selection.label ? ` · “${selection.label.slice(0, 40)}”` : ''}
      </p>
      <label htmlFor={`${id}-req`} className="sr-only">
        What should change?
      </label>
      <textarea
        id={`${id}-req`}
        className="input textarea"
        placeholder="e.g. Make it green with rounded corners"
        maxLength={2000}
        autoFocus
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (request.trim()) onApply(request.trim())
          }
        }}
      />
      <div className="row-8 end">
        <button type="button" className="btn-ghost compact" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn-primary compact" disabled={!request.trim()}>
          Apply
          <ArrowRight size={14} />
        </button>
      </div>
    </form>
  )
}
