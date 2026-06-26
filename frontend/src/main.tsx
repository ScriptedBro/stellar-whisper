import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { NotificationProvider } from './context/NotificationContext'
import { Buffer } from 'buffer'

if (typeof window !== 'undefined') {
  (window as any).Buffer = Buffer;
}
(globalThis as any).Buffer = Buffer;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NotificationProvider>
      <App />
    </NotificationProvider>
  </StrictMode>,
)

