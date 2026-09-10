import { lazy } from 'react';

const routes = [
  { path: '/dashboard',                          Element: lazy(() => import('@/app/dashboard/home/page')) },
  { path: '/dashboard/projects',                 Element: lazy(() => import('@/app/dashboard/projects/page')) },
  { path: '/dashboard/projects/:id',             Element: lazy(() => import('@/app/dashboard/project/page')), fullScreen: true },
  { path: '/dashboard/openai',                   Element: lazy(() => import('@/app/dashboard/openai/page')) },
  { path: '/dashboard/billing',                  Element: lazy(() => import('@/app/dashboard/billing/page')) },
  { path: '/dashboard/users',                    Element: lazy(() => import('@/app/dashboard/users/page')) }
];

export default routes;
