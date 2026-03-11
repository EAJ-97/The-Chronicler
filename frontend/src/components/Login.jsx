import { useState } from 'react';
import api from '../api.js';

const S = {
  page: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#07080e',
    backgroundImage: `
      radial-gradient(ellipse at 50% 0%, rgba(200,148,58,0.08) 0%, transparent 60%),
      repeating-linear-gradient(0deg, transparent, transparent 59px, rgba(255,255,255,0.015) 60px),
      repeating-linear-gradient(90deg, transparent, transparent 59px, rgba(255,255,255,0.015) 60px)
    `,
    padding: '24px',
  },
  card: {
    width: '100%', maxWidth: '400px',
    background: 'linear-gradient(160deg, #0f1219 0%, #0a0c14 100%)',
    border: '1px solid rgba(200,148,58,0.25)',
    borderRadius: '4px',
    padding: '48px 40px',
    boxShadow: '0 0 60px rgba(0,0,0,0.8), 0 0 30px rgba(200,148,58,0.04)',
    position: 'relative',
  },
  corner: {
    position: 'absolute', width: '12px', height: '12px',
    borderColor: '#c8943a', borderStyle: 'solid', opacity: 0.6,
  },
  logo: {
    textAlign: 'center', marginBottom: '36px',
  },
  title: {
    fontFamily: 'Cinzel Decorative', fontSize: '22px', fontWeight: '700',
    color: '#c8943a', letterSpacing: '0.04em', display: 'block', marginBottom: '6px',
  },
  subtitle: {
    fontFamily: 'Cinzel', fontSize: '10px', letterSpacing: '0.3em',
    color: 'rgba(200,148,58,0.5)', textTransform: 'uppercase',
  },
  divider: {
    display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px',
  },
  dividerLine: { flex: 1, height: '1px', background: 'rgba(200,148,58,0.15)' },
  dividerText: {
    fontFamily: 'Cinzel', fontSize: '9px', letterSpacing: '0.25em',
    color: 'rgba(200,148,58,0.4)',
  },
  label: {
    display: 'block', fontFamily: 'Cinzel', fontSize: '9px',
    letterSpacing: '0.2em', color: 'rgba(200,148,58,0.6)',
    marginBottom: '8px', textTransform: 'uppercase',
  },
  input: {
    width: '100%', padding: '10px 14px',
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(200,148,58,0.2)',
    borderRadius: '2px', color: '#e2d5bb', fontSize: '15px',
    fontFamily: 'Crimson Pro, serif', outline: 'none',
    transition: 'border-color 0.2s',
  },
  field: { marginBottom: '20px' },
  button: {
    width: '100%', padding: '12px',
    background: 'linear-gradient(135deg, #c8943a, #a07030)',
    border: 'none', borderRadius: '2px', cursor: 'pointer',
    fontFamily: 'Cinzel', fontSize: '11px', fontWeight: '600',
    letterSpacing: '0.25em', color: '#07080e', textTransform: 'uppercase',
    transition: 'opacity 0.2s', marginTop: '8px',
  },
  toggle: {
    textAlign: 'center', marginTop: '24px',
    fontFamily: 'Crimson Pro, serif', fontSize: '14px', color: 'rgba(226,213,187,0.5)',
  },
  toggleBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: '#c8943a', fontFamily: 'inherit', fontSize: 'inherit',
    textDecoration: 'underline', padding: '0 4px',
  },
  error: {
    padding: '10px 14px', background: 'rgba(139,32,53,0.2)',
    border: '1px solid rgba(139,32,53,0.4)', borderRadius: '2px',
    color: '#e07070', fontFamily: 'Crimson Pro, serif', fontSize: '14px',
    marginBottom: '20px',
  },
};

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const res = await api.post(endpoint, { username, password });
      onLogin(res.data.user, res.data.token);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={S.page}>
      <div style={S.card}>
        {/* Corner decorations */}
        {[
          { top: 8, left: 8, borderWidth: '1px 0 0 1px' },
          { top: 8, right: 8, borderWidth: '1px 1px 0 0' },
          { bottom: 8, left: 8, borderWidth: '0 0 1px 1px' },
          { bottom: 8, right: 8, borderWidth: '0 1px 1px 0' },
        ].map((pos, i) => (
          <div key={i} style={{ ...S.corner, ...pos }} />
        ))}

        <div style={S.logo}>
          <span style={S.title}>The Chronicler</span>
          <span style={S.subtitle}>Party Knowledge Archive</span>
        </div>

        <div style={S.divider}>
          <div style={S.dividerLine} />
          <span style={S.dividerText}>{mode === 'login' ? 'Enter the Archives' : 'Join the Party'}</span>
          <div style={S.dividerLine} />
        </div>

        {error && <div style={S.error}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div style={S.field}>
            <label style={S.label}>Adventurer Name</label>
            <input
              style={S.input}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your name..."
              autoComplete="username"
              onFocus={(e) => (e.target.style.borderColor = 'rgba(200,148,58,0.6)')}
              onBlur={(e) => (e.target.style.borderColor = 'rgba(200,148,58,0.2)')}
            />
          </div>
          <div style={S.field}>
            <label style={S.label}>Passphrase</label>
            <input
              style={S.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your passphrase..."
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onFocus={(e) => (e.target.style.borderColor = 'rgba(200,148,58,0.6)')}
              onBlur={(e) => (e.target.style.borderColor = 'rgba(200,148,58,0.2)')}
            />
          </div>
          <button
            type="submit"
            style={{ ...S.button, opacity: loading ? 0.6 : 1 }}
            disabled={loading}
          >
            {loading ? 'One moment...' : mode === 'login' ? 'Enter' : 'Create Account'}
          </button>
        </form>

        <div style={S.toggle}>
          {mode === 'login' ? "New to the party? " : "Already have a tome? "}
          <button style={S.toggleBtn} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
            {mode === 'login' ? 'Create account' : 'Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}
