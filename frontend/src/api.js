import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

/**
 * True when the response indicates an invalid/expired Chronicler JWT (logout + reload).
 * Permission-denied 403s and third-party auth failures (e.g. D&D Beyond cobalt) must not reload.
 * @param {import('axios').AxiosError} err
 * @returns {boolean}
 */
function isChroniclerSessionExpired(err) {
  return err.response?.data?.error === 'Invalid or expired session';
}

// Attach JWT to every outgoing request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On Chronicler JWT expiry (403 only), clear credentials and reload — only when a JWT was sent.
// Do not treat all 401s as logout: D&D Beyond cobalt errors and wrong-password responses use 401/422 too.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const hadAuth = !!(err.config?.headers?.Authorization);
    if (hadAuth && status === 403 && isChroniclerSessionExpired(err)) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.reload();
    }
    return Promise.reject(err);
  }
);

export default api;
