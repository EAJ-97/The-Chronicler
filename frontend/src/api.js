import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

// Attach JWT to every outgoing request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401/403, clear stale credentials and reload — only for requests that sent a JWT (not login/register/recovery).
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      const hadAuth = !!(err.config?.headers?.Authorization);
      if (hadAuth) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.reload();
      }
    }
    return Promise.reject(err);
  }
);

export default api;
