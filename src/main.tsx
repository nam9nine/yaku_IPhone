import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { clearLegacyAiFragment } from './ai/connection';
import './styles.css';
import './asagao.css';

clearLegacyAiFragment();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
