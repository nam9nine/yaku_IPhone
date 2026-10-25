import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { consumeAiInvite } from './ai/connection';
import './styles.css';
import './asagao.css';

consumeAiInvite();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
