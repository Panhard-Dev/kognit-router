import './Header.css'

export default function Header() {
  return (
    <header className="header">
      <div className="header__logo-group">
        <svg className="header__orbital" viewBox="0 0 40 40" width="40" height="40">
          <circle cx="20" cy="20" r="3" fill="#fff" />
          <ellipse cx="20" cy="20" rx="12" ry="12" fill="none" stroke="#fff" strokeWidth="0.5" className="orbit orbit--1" />
          <ellipse cx="20" cy="20" rx="16" ry="8" fill="none" stroke="#fff" strokeWidth="0.4" className="orbit orbit--2" />
          <ellipse cx="20" cy="20" rx="8" ry="16" fill="none" stroke="#fff" strokeWidth="0.4" className="orbit orbit--3" />
        </svg>
        <h1 className="header__title">KOGNIT</h1>
      </div>
      <p className="header__tagline">Centralize. Traduza. Orquestre.</p>
    </header>
  )
}
