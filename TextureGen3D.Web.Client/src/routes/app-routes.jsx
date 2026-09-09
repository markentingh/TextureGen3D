import { lazy } from 'react';

const routes = [
  { path: '/',                     Element: lazy(() => import('@/app/home/page')) },
  { path: '/login',                Element: lazy(() => import('@/app/account/login/page')) },
  { path: '/signup',               Element: lazy(() => import('@/app/account/signup/page')) },
  { path: '/forgot-password',      Element: lazy(() => import('@/app/account/forgot-password/page')) },
  { path: '/create-password/:hash', Element: lazy(() => import('@/app/account/create-password/page')) }
];

export default routes;
