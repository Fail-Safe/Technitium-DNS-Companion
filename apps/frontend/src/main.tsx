import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './context/ThemeContext'

const serviceWorkerUpdateIntervalMs = 60 * 60 * 1000

registerSW({
  immediate: true,
  onRegisteredSW(_serviceWorkerUrl, registration) {
    if (!registration) return

    const checkForUpdate = () => {
      if (document.visibilityState === 'visible') {
        void registration.update()
      }
    }

    checkForUpdate()
    window.setInterval(checkForUpdate, serviceWorkerUpdateIntervalMs)
    document.addEventListener('visibilitychange', checkForUpdate)
  },
  onRegisterError(error) {
    console.error('PWA service worker registration failed:', error)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
