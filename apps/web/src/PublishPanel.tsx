import { useId, useState, type FormEvent } from 'react'
import type { Project } from './api'
import { formatDate } from './format'
import { ArrowUpRight } from './icons'

/** "coffee-shop-d5de03ae" → "coffee-shop": a friendly first suggestion for the address. */
const suggest = (p: Project) => p.slug ?? p.folder.replace(/-[0-9a-f]{8}$/, '').slice(0, 40)

/** Publish to the management droplet and roll back (guide, Step 11). */
export function PublishPanel({
  project,
  hasVersion,
  disabled,
  publishBase,
  onPublish,
  onRollback,
}: {
  project: Project
  hasVersion: boolean
  disabled: boolean
  publishBase: string
  onPublish: (slug: string) => void
  onRollback: () => void
}) {
  const [slug, setSlug] = useState(suggest(project))
  const id = useId()
  const valid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 40

  function submit(e: FormEvent) {
    e.preventDefault()
    if (valid) onPublish(slug)
  }

  return (
    <section aria-labelledby={`${id}-pub`} className="panel stack-16">
      <h2 id={`${id}-pub`} className="eyebrow">
        Publish
      </h2>

      {project.liveUrl ? (
        <p className="live-row">
          <span className="live-dot" aria-hidden="true" />
          <span>
            Live at{' '}
            <a href={project.liveUrl} target="_blank" rel="noopener noreferrer">
              {project.liveUrl}
              <ArrowUpRight size={13} />
            </a>
            {project.publishedAt && <span className="muted"> · updated {formatDate(project.publishedAt)}</span>}
          </span>
        </p>
      ) : (
        <p className="muted">Not published yet. Publishing puts the current version online for anyone to open.</p>
      )}

      <form className="stack-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor={`${id}-slug`}>Web address</label>
          <div className="slug-row">
            <span className="slug-prefix">{publishBase}/</span>
            <input
              id={`${id}-slug`}
              className="input input-compact"
              value={slug}
              maxLength={40}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              aria-describedby={`${id}-slug-hint`}
              aria-invalid={!valid}
            />
            <span className="slug-prefix">/</span>
          </div>
          <p id={`${id}-slug-hint`} className="hint">
            Lowercase letters, digits and single hyphens.
          </p>
        </div>
        <div className="row-8">
          <button type="submit" className="btn-primary compact" disabled={disabled || !hasVersion || !valid}>
            {project.liveUrl ? 'Publish this version' : 'Publish'}
          </button>
          {project.slug && (
            <button type="button" className="btn-ghost compact" disabled={disabled} onClick={onRollback}>
              Roll back to previous
            </button>
          )}
        </div>
        {!hasVersion && <p className="hint">Build the app first, then publish it.</p>}
      </form>
    </section>
  )
}
