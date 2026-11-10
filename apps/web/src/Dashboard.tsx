import type { User } from './api'

interface Props {
  user: User
  onLogout: () => void
}

export function Dashboard({ user, onLogout }: Props) {
  return (
    <>
      <header className="topbar">
        <span className="brand">ABA</span>
        <span>
          Signed in as <strong>{user.username}</strong>{' '}
          <button type="button" onClick={onLogout}>
            Log out
          </button>
        </span>
      </header>
      <main className="card">
        <h1>Your projects</h1>
        <p>You have no projects yet. Describing an app and building it comes in the next steps.</p>
      </main>
    </>
  )
}
