import { useState, useEffect } from 'react';
import Login from './components/Login.jsx';
import Dashboard from './components/Dashboard.jsx';
import api from './api.js';
import { ThemeProvider } from './theme/ThemeContext.jsx';
import { getAuthToken, getAuthUserRaw, setAuthSession, clearAuthSession } from './utils/authStorage.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAuthToken();
    const savedUser = getAuthUserRaw();

    if (token && savedUser) {
      // Verify token is still valid before trusting it
      api.get('/auth/me')
        .then((res) => setUser({ ...res.data.user, demo_seeded: !!res.data.demo_seeded }))
        .catch(() => {
          clearAuthSession();
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  /**
   * Stores credentials after login/register and sets the signed-in user.
   * @param {object} userData
   * @param {string} token
   * @param {boolean} [rememberMe=true]
   * @returns {void}
   */
  const handleLogin = (userData, token, rememberMe = true) => {
    setAuthSession(userData, token, rememberMe);
    setUser(userData);
  };

  /**
   * Clears auth storage and returns to the login screen.
   * @returns {void}
   */
  const handleLogout = () => {
    clearAuthSession();
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
