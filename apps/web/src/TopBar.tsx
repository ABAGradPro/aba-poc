import type { User } from './api'
import { Bolt, LogOut } from './icons'

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Bolt size={18} />
      </span>
      <span className="brand-name">ABA</span>
      <span className="pill">App Builder Agent</span>
    </span>
  )
}

export function TopBar({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Brand />
        <div className="topbar-right">
          <div className="user-chip">
            <span className="avatar" aria-hidden="true">
              {user.username.charAt(0).toUpperCase()}
            </span>
            <span>
              Signed in as <strong>{user.username}</strong>
            </span>
          </div>
          <button type="button" className="btn-ghost" onClick={onLogout}>
            <LogOut size={16} />
            Log out
          </button>
        </div>
      </div>
    </header>
  )
}
