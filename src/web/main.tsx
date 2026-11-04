import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { AccessGate } from './components/AccessGate.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root nao encontrado');

createRoot(container).render(
  <React.StrictMode>
    <AccessGate>
      <App />
    </AccessGate>
  </React.StrictMode>,
);
