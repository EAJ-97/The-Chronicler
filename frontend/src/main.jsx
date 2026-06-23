import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

/** Dev (port 3002) skips the PWA service worker so vite rebuilds are not masked by cache. */
const isDevSite = window.location.port === '3002';

if ('serviceWorker' in navigator) {
  if (isDevSite) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) reg.unregister();
      });
      if ('caches' in window) {
        caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
      }
    });
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        setInterval(() => reg.update(), 60 * 1000);
      }).catch(() => {});
    });

    // Reload once when a new service worker takes control (new deployment)
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }
}
