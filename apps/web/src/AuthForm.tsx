import { useId, useState, type FormEvent } from 'react'
import { api, ApiError, type User } from './api'
import { ArrowRight } from './icons'
import { Brand } from './TopBar'

interface Props {
  mode: 'login' | 'register'
  onDone: (user: User) => void
  onSwitch: () => void
}

export function AuthForm({ mode, onDone, onSwitch }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const id = useId()
  const isLogin = mode === 'login'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (!isLogin) await api.register(username, password)
      onDone(await api.login(username, password))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page auth-page">
      <main className="auth-card">
        <Brand />
        <div className="stack-8">
          <h1 className="title">{isLogin ? 'Welcome back' : 'Create your account'}</h1>
          <p className="lead small">
            {isLogin
              ? 'Log in to keep building your apps.'
              : 'Describe an app in plain words and let the agent build it.'}
          </p>
        </div>

        <form className="stack-form" onSubmit={submit}>
          <div className="field">
            <label htmlFor={`${id}-user`}>Username</label>
            <input
              id={`${id}-user`}
              className="input"
              name="username"
              autoComplete="username"
              required
              minLength={3}
              maxLength={32}
              pattern="[a-z0-9_\-]+"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              aria-describedby={isLogin ? undefined : `${id}-user-hint`}
            />
            {!isLogin && (
              <p id={`${id}-user-hint`} className="hint">
                3–32 characters: lowercase letters, digits, "_" or "-".
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor={`${id}-pass`}>Password</label>
            <input
              id={`${id}-pass`}
              className="input"
              name="password"
              type="password"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              required
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={isLogin ? undefined : `${id}-pass-hint`}
            />
            {!isLogin && (
              <p id={`${id}-pass-hint`} className="hint">
                At least 8 characters.
              </p>
            )}
          </div>

          <p className="error" role="alert" aria-live="assertive">
            {error}
          </p>

          <button type="submit" className="btn-primary full" disabled={busy}>
            {busy ? 'Please wait…' : isLogin ? 'Log in' : 'Create account'}
            {!busy && <ArrowRight size={16} />}
          </button>
        </form>

        <p className="switch">
          {isLogin ? 'New here?' : 'Already have an account?'}{' '}
          <button type="button" className="btn-link" onClick={onSwitch}>
            {isLogin ? 'Create an account' : 'Log in'}
          </button>
        </p>
      </main>
    </div>
  )
}
