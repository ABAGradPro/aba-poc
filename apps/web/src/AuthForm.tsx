import { useId, useState, type FormEvent } from 'react'
import { api, ApiError, type User } from './api'

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
    <main className="card">
      <h1>{isLogin ? 'Log in to ABA' : 'Create your ABA account'}</h1>
      <form onSubmit={submit} noValidate={false}>
        <label htmlFor={`${id}-user`}>Username</label>
        <input
          id={`${id}-user`}
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

        <label htmlFor={`${id}-pass`}>Password</label>
        <input
          id={`${id}-pass`}
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

        <p className="error" role="alert" aria-live="assertive">
          {error}
        </p>

        <button type="submit" disabled={busy}>
          {busy ? 'Please wait…' : isLogin ? 'Log in' : 'Create account'}
        </button>
      </form>

      <p className="switch">
        {isLogin ? 'New here?' : 'Already have an account?'}{' '}
        <button type="button" className="link" onClick={onSwitch}>
          {isLogin ? 'Create an account' : 'Log in'}
        </button>
      </p>
    </main>
  )
}
