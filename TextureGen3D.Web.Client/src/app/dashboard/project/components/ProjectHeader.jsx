import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProject } from '@/context/project';
import Icon from '@/components/ui/icon';

export default function ProjectHeader({ showPanel, setShowPanel }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { project, models, logout } = useProject();

  return (
    <>
      {/* Hamburger button */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed top-4 left-4 z-30 p-2 rounded-lg bg-white/90 dark:bg-gray-800/90 backdrop-blur shadow-md border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-700 transition"
        aria-label="Open menu"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Project title overlay (top-center) */}
      {project && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-20 text-center pointer-events-none">
          <h1 className="text-xl font-bold text-white drop-shadow-lg">{project.title}</h1>
          {project.description && (
            <p className="text-sm text-gray-300 drop-shadow-lg mt-0.5">{project.description}</p>
          )}
        </div>
      )}

      {/* Toggle panel button (bottom-left) — only visible when panel is minimized */}
      {!showPanel && models.length > 0 && (
        <button
          onClick={() => setShowPanel(true)}
          className="fixed bottom-4 left-4 z-30 p-2 rounded-lg bg-white/90 dark:bg-gray-800/90 backdrop-blur shadow-md border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-700 transition"
          aria-label="Show upload panel"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
      )}

      {/* Slide-out sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Slide-out sidebar (left) */}
      <aside
        className={`fixed top-0 left-0 z-50 h-screen w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transform transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-xl font-bold text-primary-600 dark:text-primary-500">TextureGen3D</h2>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1 rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition"
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            <li>
              <Link to="/dashboard" className="block px-4 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                Dashboard
              </Link>
            </li>
            <li>
              <Link to="/dashboard/projects" className="block px-4 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                Projects
              </Link>
            </li>
            <li>
              <Link to="/dashboard/openai" className="block px-4 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                OpenAI
              </Link>
            </li>
            <li>
              <Link to="/dashboard/billing" className="block px-4 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                Billing
              </Link>
            </li>
            <li>
              <Link to="/dashboard/users" className="block px-4 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                Users
              </Link>
            </li>
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
      </aside>
    </>
  );
}
