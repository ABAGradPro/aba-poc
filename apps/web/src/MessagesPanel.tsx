import { useCallback, useEffect, useId, useState } from 'react'
import { api, ApiError, type SiteMessage } from './api'
import { formatDate } from './format'

/** What visitors sent through the contact forms of this project's preview. */
export function MessagesPanel({ projectId }: { projectId: string }) {
  const [messages, setMessages] = useState<SiteMessage[] | null>(null)
  const [error, setError] = useState('')
  const id = useId()

  const load = useCallback(() => {
    api
      .messages(projectId)
      .then((list) => {
        setMessages(list)
        setError('')
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not reach the server.'))
  }, [projectId])

  // New messages arrive from the preview at any time, so look again every few seconds.
  useEffect(() => {
    load()
    const timer = window.setInterval(load, 8000)
    return () => window.clearInterval(timer)
  }, [load])

  async function remove(messageId: string) {
    try {
      await api.deleteMessage(projectId, messageId)
      setMessages((list) => list?.filter((m) => m.id !== messageId) ?? null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.')
    }
  }

  return (
    <section aria-labelledby={`${id}-messages`} className="panel stack-16">
      <div className="row-between">
        <h2 id={`${id}-messages`} className="eyebrow">
          Messages{messages?.length ? ` (${messages.length})` : ''}
        </h2>
        <button type="button" className="btn-ghost small" onClick={load}>
          Refresh
        </button>
      </div>
      <p className="muted">
        What people send through the forms of your site appears here. This works in the preview on this computer;
        the published site cannot save messages yet and tells visitors so.
      </p>
      <p className="error" role="alert">
        {error}
      </p>
      {messages && messages.length === 0 && <p className="hint">No messages yet. Try the contact form in the preview.</p>}
      {messages && messages.length > 0 && (
        <ul className="message-list" aria-live="polite">
          {messages.map((m) => {
            const extra = Object.entries(m.fields).filter(
              ([key, value]) => value !== m.name && value !== m.message && !m.contact.includes(value) && key !== '',
            )
            return (
              <li key={m.id} className="message">
                <div className="row-between">
                  <strong className="truncate">{m.name || 'No name given'}</strong>
                  <span className="hint">{formatDate(m.createdAt)}</span>
                </div>
                {m.contact && <p className="message-contact">{m.contact}</p>}
                {m.message && <p className="message-text">{m.message}</p>}
                {extra.length > 0 && (
                  <dl className="message-extra">
                    {extra.map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <div>
                  <button type="button" className="btn-link" onClick={() => void remove(m.id)}>
                    Delete
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
