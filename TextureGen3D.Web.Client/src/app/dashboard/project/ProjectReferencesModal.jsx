import React, { useState, useRef, useEffect } from 'react';
import Modal from '@/components/ui/modal';
import Spinner from '@/components/ui/spinner';
import { ProjectReferences } from '@/api/user/projectReferences';
import { ProjectMeshReferences } from '@/api/user/projectMeshReferences';

export default function ProjectReferencesModal({ projectId, token, meshId, onClose, onAdded, onDeleted, onProjectReferencesChanged }) {
  const [projectRefs, setProjectRefs] = useState([]);
  const [meshRefIds, setMeshRefIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const loadProjectRefs = async () => {
    try {
      const api = ProjectReferences({ token });
      const res = await api.getByProject(projectId);
      if (res.data?.success) setProjectRefs(res.data.data || []);
    } catch { /* ignore */ }
  };

  const loadMeshRefs = async () => {
    if (!meshId) { setMeshRefIds(new Set()); return; }
    try {
      const api = ProjectMeshReferences({ token });
      const res = await api.getByMesh(projectId, meshId);
      if (res.data?.success) {
        const ids = new Set(res.data.data.map((mr) => mr.projectReferenceId));
        setMeshRefIds(ids);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadProjectRefs(), loadMeshRefs()]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, meshId, token]);

  const handleFiles = async (files) => {
    const validExt = ['png', 'jpg', 'jpeg', 'webp'];
    const validFiles = Array.from(files).filter((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return validExt.includes(ext);
    });
    if (validFiles.length === 0) return;
    setUploading(true);
    try {
      const api = ProjectReferences({ token });
      for (const file of validFiles) {
        await api.upload(projectId, file);
      }
      await loadProjectRefs();
      onProjectReferencesChanged?.();
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) handleFiles(files);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) handleFiles(files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleToggleMeshRef = async (refId) => {
    if (!meshId) return;
    const api = ProjectMeshReferences({ token });
    if (meshRefIds.has(refId)) {
      // Remove from mesh — find the mesh ref record and delete it
      try {
        const res = await api.getByMesh(projectId, meshId);
        if (res.data?.success) {
          const meshRef = res.data.data.find((mr) => mr.projectReferenceId === refId);
          if (meshRef) {
            await api.delete(projectId, meshRef.id);
          }
        }
      } catch (err) {
        console.error('Failed to remove reference from mesh:', err);
      }
      setMeshRefIds((prev) => { const next = new Set(prev); next.delete(refId); return next; });
      onDeleted?.(refId);
    } else {
      // Add to mesh
      try {
        await api.add(projectId, meshId, refId);
      } catch (err) {
        console.error('Failed to add reference to mesh:', err);
      }
      setMeshRefIds((prev) => new Set(prev).add(refId));
      onAdded?.(refId);
    }
  };

  const handleDeleteProjectRef = async (refId) => {
    if (!confirm('Delete this reference image from the project? This will remove it from all meshes and delete the file.')) return;
    try {
      const api = ProjectReferences({ token });
      await api.delete(projectId, refId);
      setProjectRefs((prev) => prev.filter((r) => r.id !== refId));
      setMeshRefIds((prev) => { const next = new Set(prev); next.delete(refId); return next; });
      onProjectReferencesChanged?.();
    } catch (err) {
      console.error('Failed to delete project reference:', err);
    }
  };

  const refApi = ProjectReferences({ token });

  return (
    <Modal title="Project References" onClose={onClose} className="max-w-[1000px]">
      <div className="space-y-3">
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner className="text-2xl" />
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Click a thumbnail to {meshId ? 'toggle it for this mesh' : 'select it'}. Click the trash icon to delete from the project.
            </p>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`grid grid-cols-5 gap-2 p-2 rounded-lg transition ${
                dragOver ? 'bg-purple-50 dark:bg-purple-900/20 ring-2 ring-purple-500' : ''
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              {/* Upload cell */}
              <div
                onClick={() => !uploading && fileInputRef.current?.click()}
                className={`relative border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition ${
                  uploading ? 'opacity-50 pointer-events-none' : 'border-gray-300 dark:border-gray-600 hover:border-purple-400 dark:hover:border-purple-500'
                }`}
                style={{ width: 150, height: 150 }}
              >
                {uploading ? (
                  <Spinner className="text-xs" />
                ) : (
                  <>
                    <svg className="w-5 h-5 text-gray-400 dark:text-gray-500 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span className="text-[8px] text-gray-400 dark:text-gray-500 text-center leading-tight px-1">Drag & drop</span>
                  </>
                )}
              </div>

              {projectRefs.map((ref) => {
                const isSelected = meshRefIds.has(ref.id);
                return (
                  <div
                    key={ref.id}
                    onClick={() => handleToggleMeshRef(ref.id)}
                    className={`relative rounded-lg overflow-hidden border-2 cursor-pointer transition ${
                      isSelected ? 'border-purple-500 ring-1 ring-purple-500' : 'border-gray-200 dark:border-gray-600 hover:border-purple-300'
                    }`}
                    style={{ width: 150, height: 150 }}
                  >
                    <img
                      src={refApi.thumbUrl(projectId, ref.id)}
                      alt={ref.filename}
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                    {isSelected && (
                      <div className="absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded bg-purple-600 text-white flex items-center justify-center">
                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteProjectRef(ref.id); }}
                      className="absolute bottom-0.5 right-0.5 p-0.5 rounded bg-black/50 text-white opacity-0 hover:opacity-100 hover:bg-red-600 transition"
                      aria-label="Delete from project"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
