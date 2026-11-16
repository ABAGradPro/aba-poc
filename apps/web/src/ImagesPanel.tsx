import { useId, useState, type ChangeEvent, type RefObject } from 'react'
import { api, ApiError, PREVIEW_ORIGIN, type ProjectImage } from './api'

const MAX_BYTES = 5 * 1024 * 1024
const MAX_OWN = 12

/**
 * The project's images: the user's own uploads (with a short description for the AI builder)
 * and the stock photos the builder fetched. The next build uses the user's images first.
 */
export function ImagesPanel({
  projectId,
  images,
  disabled,
  pickRef,
  onChange,
}: {
  projectId: string
  images: ProjectImage[]
  disabled: boolean
  /** The hidden file input, so "Add my images" elsewhere on the page can open the picker. */
  pickRef: RefObject<HTMLInputElement | null>
  onChange: (images: ProjectImage[]) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const id = useId()
  const own = images.filter((i) => !i.stock)
  const stock = images.filter((i) => i.stock)

  async function reload() {
    onChange(await api.images(projectId))
  }

  async function add(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // picking the same file again should work
    if (!files.length) return
    setError('')
    setBusy(true)
    try {
      let room = MAX_OWN - own.length
      for (const file of files) {
        if (room <= 0) {
          setError(`A project can have at most ${MAX_OWN} of your own images.`)
          break
        }
        if (file.size > MAX_BYTES) {
          setError(`“${file.name}” is larger than 5 MB and was skipped.`)
          continue
        }
        await api.uploadImage(projectId, file)
        room -= 1
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.')
    } finally {
      await reload().catch(() => undefined)
      setBusy(false)
    }
  }

  async function act(change: () => Promise<unknown>) {
    setError('')
    setBusy(true)
    try {
      await change()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.')
    } finally {
      await reload().catch(() => undefined)
      setBusy(false)
    }
  }

  const locked = disabled || busy

  return (
    <section aria-labelledby={`${id}-images`} className="panel stack-16">
      <h2 id={`${id}-images`} className="eyebrow">
        Images
      </h2>
      <p className="muted">
        Add your logo and photos of your place or products. Say what each one shows, and the next build will use
        them. Where you add none, free stock photos are used.
      </p>

      {own.length > 0 && (
        <ul className="image-list">
          {own.map((image) => (
            <li key={image.file} className="image-row">
              <img className="image-thumb" src={`${PREVIEW_ORIGIN}/p/${projectId}/images/${image.file}`} alt="" />
              <div className="image-body">
                <label className="sr-only" htmlFor={`${id}-${image.file}`}>
                  What {image.file} shows
                </label>
                <input
                  id={`${id}-${image.file}`}
                  className="input input-compact"
                  maxLength={120}
                  placeholder="What does it show? e.g. our shop front"
                  defaultValue={image.caption}
                  disabled={locked}
                  onBlur={(e) => {
                    const caption = e.target.value.trim()
                    if (caption !== image.caption) void act(() => api.captionImage(projectId, image.file, caption))
                  }}
                />
                <span className="hint truncate">{image.file}</span>
              </div>
              <button
                type="button"
                className="btn-ghost small"
                disabled={locked}
                onClick={() => void act(() => api.deleteImage(projectId, image.file))}
                aria-label={`Remove ${image.file}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {stock.length > 0 && (
        <div className="stack-8">
          <p className="hint">Stock photos the AI builder added</p>
          <ul className="stock-strip">
            {stock.map((image) => (
              <li key={image.file}>
                <img
                  className="image-thumb"
                  src={`${PREVIEW_ORIGIN}/p/${projectId}/images/${image.file}`}
                  alt={image.caption || image.file}
                  title={image.caption || image.file}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="error" role="alert">
        {error}
      </p>
      <div className="row-8">
        <input
          ref={pickRef}
          id={`${id}-pick`}
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          disabled={locked}
          onChange={(e) => void add(e)}
        />
        <label htmlFor={`${id}-pick`} className={`btn-ghost compact${locked ? ' is-disabled' : ''}`}>
          {busy ? 'Saving…' : 'Add images'}
        </label>
        <span className="hint">JPG, PNG, WebP or GIF · up to 5 MB each · {own.length} of {MAX_OWN}</span>
      </div>
    </section>
  )
}
