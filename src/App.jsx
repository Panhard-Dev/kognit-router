import './App.css'
import { useState } from 'react'
import CoreOrb from './components/CoreOrb/CoreOrb'
import Sidebar from './components/Sidebar/Sidebar'
import HomePage from './components/HomePage/HomePage'
import ProvidersPage from './components/ProvidersPage/ProvidersPage'
import UsageAnalyticsPage from './components/UsageAnalyticsPage/UsageAnalyticsPage'
import CliToolsPage from './components/CliToolsPage/CliToolsPage'
import QuotaTrackerPage from './components/QuotaTrackerPage/QuotaTrackerPage'

function App() {
  const [activePage, setActivePage] = useState('home')
  const page = activePage === 'providers'
    ? <ProvidersPage />
    : activePage === 'usage'
      ? <UsageAnalyticsPage />
      : activePage === 'quota'
        ? <QuotaTrackerPage />
      : activePage === 'cli'
        ? <CliToolsPage />
        : <HomePage />

  return (
    <div className="app">
      <Sidebar active={activePage} onSelect={setActivePage} />
      <div className={`app__content app__content--${activePage}`}>
        {page}
      </div>
      <CoreOrb />
    </div>
  )
}

export default App
