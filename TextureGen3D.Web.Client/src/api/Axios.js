import axios from 'axios';

const instance = axios.create({
  headers: {
    'Content-Type': 'application/json'
  }
});

instance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('user');
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/account/login')) {
        window.location.href = '/account/login';
      }
    }
    return Promise.reject(error);
  }
);

export function UseAxios(session) {
  const { token } = session || {};

  if (token) {
    instance.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete instance.defaults.headers.common['Authorization'];
  }

  return instance;
}
