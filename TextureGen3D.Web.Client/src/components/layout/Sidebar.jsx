import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSession } from '@/context/session';
import ThemeToggle from '@/components/ui/theme-toggle';

export default function Sidebar() {
  const { logout, user } = useSession();
  const location = useLocation();

  const navItems = [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/dashboard/projects', label: 'Projects', match: ['/dashboard/projects'] },
    { path: '/dashboard/openai', label: 'OpenAI' },
    { path: '/dashboard/billing', label: 'Billing' },
    { path: '/dashboard/users', label: 'Users' },
  ];

  return (
    <aside className="w-64 h-screen fixed left-0 top-0 flex flex-col bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-xl font-bold text-primary-600 dark:text-primary-500">TextureGen3D</h2>
        {user && <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{user.displayName}</p>}
      </div>
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {navItems.map((item) => {
            const isActive = item.match
              ? item.match.some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`))
              : location.pathname === item.path;
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={`block px-4 py-2 rounded transition ${
                    isActive
                      ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              onClick={logout}
              className="w-full py-2 px-4 text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition"
            >
              Log out
            </button>
          </li>
        </ul>
      </nav>
      <div className="p-4 border-t border-gray-200 dark:border-gray-700">
        <div className="mb-4">
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
