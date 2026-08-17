import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import EmotionThreadDemo from './emotion-thread/EmotionThreadDemo.jsx'

// No router in this project — a single path check is enough to reach the standalone EmotionThread
// demo (see EmotionThreadDemo.jsx) without touching the main app's App.jsx.
const isEmotionThreadDemo = window.location.pathname.replace(/\/+$/, '') === '/emotion-thread'

createRoot(document.getElementById('root')).render(
  <StrictMode>{isEmotionThreadDemo ? <EmotionThreadDemo /> : <App />}</StrictMode>,
)
