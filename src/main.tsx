import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import AdminPanel from './AdminPanel.tsx'

const el = document.getElementById('root')!
const path = typeof window !== 'undefined' ? window.location.pathname : ''

if (path === '/admin' || path.startsWith('/admin/')) {
  createRoot(el).render(
    <StrictMode>
      <AdminPanel />
    </StrictMode>,
  )
} else {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
