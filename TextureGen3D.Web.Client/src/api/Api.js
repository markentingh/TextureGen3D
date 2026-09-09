import { UseAxios } from './Axios';

const Api = (args) => {
  const api = UseAxios(args);

  return {
    endpoints: (callback) => callback({ api, ...args })
  };
};

export { Api };
