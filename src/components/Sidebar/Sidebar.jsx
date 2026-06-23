import './Sidebar.css'

const menuItems = [
  {
    id: 'home',
    label: 'Home',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
      </svg>
    ),
  },
  {
    id: 'providers',
    label: 'Providers',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
        <circle cx="17" cy="8" r="1" fill="currentColor" />
        <circle cx="17" cy="16" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'creator',
    label: 'Creator Modelo',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
      </svg>
    ),
  },
  {
    id: 'usage',
    label: 'Usage & Analytics',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    id: 'quota',
    label: 'Quota Tracker',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3v9l6 3" />
      </svg>
    ),
  },
  {
    id: 'cli',
    label: 'CLI Tools',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4,17 10,11 4,5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
  },
]

const navigableItems = new Set(['home', 'providers', 'usage', 'quota', 'cli'])

export default function Sidebar({ active = 'home', onSelect }) {
  return (
    <nav className="sidebar">
      <div className="sidebar__brand">K</div>
      <div className="sidebar__menu">
        {menuItems.map((item) => (
          <button
            key={item.id}
            className={`sidebar__item ${item.id === active ? 'sidebar__item--active' : ''}`}
            title={item.label}
            onClick={() => {
              if (navigableItems.has(item.id)) {
                onSelect?.(item.id)
              }
            }}
          >
            <span className="sidebar__icon">{item.icon}</span>
            <span className="sidebar__label">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
