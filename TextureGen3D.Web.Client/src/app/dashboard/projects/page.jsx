import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/context/session';
import { Projects } from '@/api/user/projects';
import Spinner from '@/components/ui/spinner';
import Modal from '@/components/ui/modal';

export default function ProjectsPage() {
  const { token } = useSession();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newProject, setNewProject] = useState({ title: '', description: '', key: '', color: '' });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadProjects();
  }, [token]);

  const loadProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const api = Projects({ token });
      const res = await api.getAll();
      if (res.data.success) {
        setProjects(res.data.data || []);
      } else {
        setError(res.data.message || 'Failed to load projects');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newProject.title.trim()) return;
    setCreating(true);
    try {
      const api = Projects({ token });
      const res = await api.create(newProject);
      if (res.data.success) {
        setShowCreate(false);
        setNewProject({ title: '', description: '', key: '', color: '' });
        await loadProjects();
      } else {
        setError(res.data.message || 'Failed to create project');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner className="text-3xl" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Projects</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition"
        >
          New Project
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded">
          {error}
        </div>
      )}

      {projects.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          No projects yet. Click "New Project" to create one.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/dashboard/projects/${project.id}`}
              className="group block rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 hover:shadow-lg transition"
            >
              <div className="aspect-square bg-gray-50 dark:bg-gray-800 flex items-center justify-center overflow-hidden">
                {project.hasThumb ? (
                  <img
                    src={`/api/projects/${project.id}/thumb`}
                    alt={project.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600">
                    <span className="text-gray-400 dark:text-gray-500 text-sm">No Preview</span>
                  </div>
                )}
              </div>
              <div className="p-3">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">{project.title}</h3>
                {project.key && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{project.key}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="New Project" onClose={() => setShowCreate(false)}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Title</label>
              <input
                type="text"
                value={newProject.title}
                onChange={(e) => setNewProject({ ...newProject, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                placeholder="Project title"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea
                value={newProject.description}
                onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                placeholder="Project description"
                rows={3}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Key</label>
              <input
                type="text"
                value={newProject.key}
                onChange={(e) => setNewProject({ ...newProject, key: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                placeholder="Project key (optional)"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !newProject.title.trim()}
              className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 transition"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
