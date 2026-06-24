import { useState, useEffect } from 'react';
import Login from './components/Login.jsx';
import Dashboard from './components/Dashboard.jsx';
import api from './api.js';
import { ThemeProvider } from './theme/ThemeContext.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');

    if (token && savedUser) {
      // Verify token is still valid before trusting it
      api.get('/auth/me')
        .then((res) => setUser({ ...res.data.user, demo_seeded: !!res.data.demo_seeded }))
        .catch(() => {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const handleLogin = (userData, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  if (loading) {
    return (
      <ThemeProvider userId={null}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100vh', background: 'var(--ch-shell-bg, #07080e)',
        }}>
          <div style={{ fontFamily: 'var(--ch-font-display, Cinzel)', color: 'var(--ch-accent, #c8943a)', letterSpacing: '0.2em', fontSize: '14px' }}>
            LOADING...
          </div>
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider userId={user?.id ?? null}>
      {user
        ? <Dashboard user={user} onLogout={handleLogout} />
        : <Login onLogin={handleLogin} />}
    </ThemeProvider>
  );
}
