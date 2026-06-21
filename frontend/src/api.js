import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

/**
 * True when a 403 body indicates an invalid/expired JWT (logout + reload), not route permission denial.
 * @param {import('axios').AxiosError} err
 * @returns {boolean}
 */
function isSessionForbidden(err) {
  return err.response?.data?.error === 'Invalid or expired session';
}

// Attach JWT to every outgoing request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401 (or 403 session invalid), clear stale credentials and reload — only when a JWT was sent.
// Permission-denied 403s are rejected normally so callers can show errors without a full page reload.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const hadAuth = !!(err.config?.headers?.Authorization);
    if (hadAuth && (status === 401 || (status === 403 && isSessionForbidden(err)))) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.reload();
    }
    return Promise.reject(err);
  }
);

export default api;
