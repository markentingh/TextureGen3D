import { Api } from '@/api/Api';

const Users = (args) => Api({ ...args }).endpoints(({ api }) => {
  const apiPath = '/api/users';
  return {
    add: (user) => api.post(`${apiPath}/add`, user),
    register: (user) => api.post(`${apiPath}/register`, user),
    forgotPassword: (email) => api.post(`${apiPath}/forgot-password`, { Email: email }),
    getById: (userId) => api.get(`${apiPath}/get/${userId}`),
    getMyInfo: () => api.get(`${apiPath}/my-info`),
    edit: (user) => api.post(`${apiPath}/edit`, user),
    delete: (userId) => api.delete(`${apiPath}/delete/${userId}`),
  };
});

export { Users };
