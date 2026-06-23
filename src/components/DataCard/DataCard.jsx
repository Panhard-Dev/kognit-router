import './DataCard.css'

const icons = {
  activity: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polyline points="22,12 18,12 15,21 9,3 6,12 2,12" />
    </svg>
  ),
  zap: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polygon points="13,2 3,14 12,14 11,22 21,10 12,10" />
    </svg>
  ),
  nodes: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" />
      <line x1="12" y1="7" x2="5" y2="17" /><line x1="12" y1="7" x2="19" y2="17" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 2l7 4v5c0 5-3.5 9.74-7 11-3.5-1.26-7-6-7-11V6l7-4z" />
    </svg>
  ),
}

export default function DataCard({ label, value, icon }) {
  return (
    <div className="data-card">
      <div className="data-card__icon">{icons[icon]}</div>
      <span className="data-card__label">{label}</span>
      <span className="data-card__value">{value}</span>
    </div>
  )
}
