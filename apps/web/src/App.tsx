import { useEffect, useState } from 'react'
import { api, type User } from './api'
import { AuthForm } from './AuthForm'
import { Dashboard } from './Dashboard'
import './App.css'

type View = 'loading' | 'login' | 'register' | 'dashboard'

export default function App() {
  const [view, setView] = useState<View>('loading')
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    // Already logged in? The cookie is httpOnly, so ask the API.
    api
      .me()
      .then((u) => {
        setUser(u)
        setView('dashboard')
      })
      .catch(() => setView('login'))
  }, [])

  function loggedIn(u: User) {
    setUser(u)
    setView('dashboard')
  }

  async function logout() {
    await api.logout().catch(() => undefined)
    setUser(null)
    setView('login')
  }

  if (view === 'loading') return <p className="loading">Loading…</p>
  if (view === 'dashboard' && user) return <Dashboard user={user} onLogout={logout} />
  return (
    <AuthForm
      key={view}
      mode={view === 'register' ? 'register' : 'login'}
      onDone={loggedIn}
      onSwitch={() => setView(view === 'register' ? 'login' : 'register')}
    />
  )
}
