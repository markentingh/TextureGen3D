import { lazy } from 'react';

const routes = [
  { path: '/dashboard',       Element: lazy(() => import('@/app/dashboard/home')) },
  { path: '/dashboard/users', Element: lazy(() => import('@/app/dashboard/users')) }
];

export default routes;
