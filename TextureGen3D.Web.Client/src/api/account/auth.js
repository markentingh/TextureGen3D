const Auth = (api) => {
  const apiPath = '/api/auth';
  return {
    login: (username, password) => api.post(`${apiPath}/login`, { Username: username, Password: password }),
    refreshToken: (token) => api.post(`${apiPath}/refresh-token`, { Token: token }),
    checkAuth: () => api.get(`${apiPath}/check-auth`),
    checkPasswordReset: (hash) => api.post(`${apiPath}/check-password-reset`, { Hash: hash }),
    updatePassword: (hash, password) => api.post(`${apiPath}/update-password`, { Hash: hash, Password: password }),
  };
};

export { Auth };
