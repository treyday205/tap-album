
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

const canRegisterServiceWorker =
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  ((import.meta as any).env?.PROD ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1');

if (canRegisterServiceWorker) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => {
        if ((import.meta as any).env?.DEV) {
          console.warn('[PWA] service worker registration failed', err);
        }
      });
  });
}
