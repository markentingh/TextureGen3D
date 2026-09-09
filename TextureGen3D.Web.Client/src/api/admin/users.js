import { Api } from '@/api/Api';

const Users = (args) => Api({ ...args }).endpoints(({ api }) => {
  const apiPath = '/api/admin/users';
  return {
    getAllFiltered: (filter) => api.post(`${apiPath}/get-all-filtered`, filter),
    getById: (userId) => api.get(`${apiPath}/get/${userId}`),
    getRoles: () => api.get(`${apiPath}/get-roles`),
    updateFullName: (user) => api.post(`${apiPath}/update-full-name`, user),
    sendPasswordReset: (userId) => api.post(`${apiPath}/send-password-reset`, { UserId: userId }),
    updateLock: (request) => api.post(`${apiPath}/update-lock`, request),
  };
});

export { Users };
