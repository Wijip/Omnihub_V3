import axios from 'axios';

const baseURL = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:3000/api` : '/api';

const api = axios.create({
  baseURL: baseURL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token') || localStorage.getItem('omnihub_token');
  // PATCH: Blokir pengiriman string 'undefined' atau 'null' yang memicu jwt malformed
  if (token && token !== 'undefined' && token !== 'null') {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

export default api;
