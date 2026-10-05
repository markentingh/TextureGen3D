import React, { useState, useRef } from 'react';
import { useProject } from '@/context/project';
import { ProjectModels } from '@/api/user/projectModels';
import { Projects } from '@/api/user/projects';
import Icon from '@/components/ui/icon';
import Spinner from '@/components/ui/spinner';
import Select from '@/components/forms/select';
import Slider from '@/components/ui/slider';
import ToggleButtons from '@/components/ui/toggle-buttons';
import { useModal } from '@/context/modal';

export default function ProjectSettings() {
  const {
    id,
    token,
    textureResolution,
    setProject,
    models,
    setModels,
    meshData,
    setMeshData,
    parseErrors,
    setParseErrors,
    parsingModels,
    allMeshes,
    selectedMesh,
    setSelectedMesh,
    loadProject,
    parseUploadedFile,
    reuploadModelFile,
    viewerRef,
    emissiveStrength,
    setEmissiveStrength,
    bloom,
    setBloom,
    settingsCollapsed,
    setSettingsCollapsed,
    formatTriangleCount,
  } = useProject();
  const { showModal, hideModal } = useModal();

  // ── Local state ──
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const reuploadInputRef = useRef(null);
  const reuploadModelIdRef = useRef(null);
  const [projectionMode, setProjectionMode] = useState('orthographic');

  // ── formatFileSize ──
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // ── handleReuploadClick / handleReuploadSelect ──
  // Upload a newer version of a model. Mesh records are matched by name
  // server-side and updated in place — layers, camera angles and references
  // keep pointing at the same record ids.
  const handleReuploadClick = (model, e) => {
    e.stopPropagation();
    reuploadModelIdRef.current = model.id;
    reuploadInputRef.current?.click();
  };

  const handleReuploadSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const modelId = reuploadModelIdRef.current;
    reuploadModelIdRef.current = null;
    if (!file || !modelId) return;
    const allowedExtensions = ['fbx', 'obj', 'abc', 'usd', 'ply', 'stl'];
    const ext = file.name.split('.').pop().toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      setUploadError(`Unsupported file type. Allowed: .fbx, .obj, .abc, .usd, .ply, .stl`);
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      const res = await reuploadModelFile(modelId, file);
      if (!res?.success) setUploadError(res?.message || 'Re-upload failed');
    } finally {
      setUploading(false);
    }
  };

  // ── File upload handlers ──
  const handleFileUpload = async (file) => {
    if (!file) return;
    const allowedExtensions = ['fbx', 'obj', 'abc', 'usd', 'ply', 'stl'];
    const ext = file.name.split('.').pop().toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      setUploadError(`Unsupported file type. Allowed: .fbx, .obj, .abc, .usd, .ply, .stl`);
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const api = ProjectModels({ token });
      const res = await api.upload(id, file);
      if (res.data.success) {
        const newModel = res.data.data;
        const modelsApi = ProjectModels({ token });
        const modelsRes = await modelsApi.getByProject(id);
        if (modelsRes.data.success) {
          setModels(modelsRes.data.data || []);
        }
        if (newModel) {
          await parseUploadedFile(newModel.id, file);
        }
      } else {
        setUploadError(res.data.message || 'Upload failed');
      }
    } catch (err) {
      setUploadError(err.response?.data?.message || err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileUpload(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  // ── handleDeleteModelClick — confirm modal, then delete ──
  const handleDeleteModelClick = (model) => {
    showModal({
      title: 'Delete 3D Model',
      onClose: hideModal,
      body: (
        <>
          <p className="text-gray-700 dark:text-gray-300 mb-6">
            Do you really want to delete this 3D model {model.filename}? All related meshes will be deleted as well.
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={hideModal}
              className="px-4 py-2 border-2 border-gray-400 text-gray-600 dark:text-gray-300 dark:border-gray-500 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition font-medium text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                hideModal();
                handleDeleteModel(model.id);
              }}
              className="px-4 py-2 border-2 border-green-600 text-green-600 dark:text-green-400 dark:border-green-500 rounded-lg hover:bg-green-600 hover:text-white dark:hover:bg-green-600 dark:hover:text-white transition font-medium text-sm"
            >
              Delete 3D Model
            </button>
          </div>
        </>
      ),
    });
  };

  // ── handleDeleteModel ──
  const handleDeleteModel = async (modelId) => {
    try {
      const api = ProjectModels({ token });
      const res = await api.delete(id, modelId);
      if (res.data.success) {
        setMeshData((prev) => {
          const next = { ...prev };
          delete next[modelId];
          return next;
        });
        setParseErrors((prev) => {
          const next = { ...prev };
          delete next[modelId];
          return next;
        });
        if (selectedMesh && selectedMesh.modelId === modelId) {
          setSelectedMesh(null);
        }
        await loadProject();
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  return (
    /* Pinned to the bottom of the sidebar */
    <div className="flex-shrink-0 overflow-y-auto max-h-[60%] border-t border-gray-200 dark:border-gray-700">
      {/* Project Settings accordion title — matches the Generate Images
          panel header; collapsing leaves just this bar at the bottom */}
      <div className={`flex items-center justify-between p-3 ${settingsCollapsed ? '' : 'border-b border-gray-200 dark:border-gray-700'}`}>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Project Settings</h3>
        <button
          onClick={() => setSettingsCollapsed((v) => !v)}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
          aria-label={settingsCollapsed ? 'Expand project settings' : 'Collapse project settings'}
        >
          <svg
            className={`w-4 h-4 transition-transform ${settingsCollapsed ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {!settingsCollapsed && (
      <>
      {/* Texture Resolution section */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Texture Resolution</h3>
        <Select
          value={String(textureResolution)}
          onChange={async (e) => {
            const resolution = parseInt(e.target.value, 10);
            setProject((prev) => (prev ? { ...prev, textureResolution: resolution } : prev));
            try {
              await Projects({ token }).updateTextureResolution({ id, textureResolution: resolution });
            } catch (err) {
              console.error('Failed to save texture resolution:', err);
            }
          }}
          options={[
            { value: '1024', label: '1K Textures' },
            { value: '2048', label: '2K Textures' },
            { value: '4096', label: '4K Textures' },
          ]}
        />
      </div>

      {/* Viewport section */}
      {allMeshes.length > 0 && (
        <div className="p-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Viewport</h3>
          <ToggleButtons
            value={projectionMode}
            onChange={(v) => { setProjectionMode(v); viewerRef.current?.setProjectionMode(v); }}
            options={[
              { value: 'perspective', label: 'Perspective' },
              { value: 'orthographic', label: 'Orthographic' },
            ]}
          />
        </div>
      )}

      {/* Emissive Properties section — drives the layer shader's
          u_emissiveStrength multiplier and the viewer's bloom pass */}
      {allMeshes.length > 0 && (
        <div className="p-3 border-b border-gray-200 dark:border-gray-700 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Emissive Properties</h3>
          <Slider
            label="Emissive Strength"
            value={emissiveStrength}
            onChange={setEmissiveStrength}
            min={0}
            max={500}
            step={1}
            small
          />
          <Slider
            label="Bloom"
            value={bloom}
            onChange={setBloom}
            min={0}
            max={100}
            step={1}
            small
          />
        </div>
      )}

      {/* Models section (upload + model list) */}
      <div className="p-3 space-y-3">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Models</h4>

        {/* Upload area */}
        <div
          onClick={() => !uploading && fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition ${
            dragOver
              ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
              : 'border-gray-300 dark:border-gray-600 hover:border-purple-400 dark:hover:border-purple-500'
          } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".fbx,.obj,.abc,.usd,.ply,.stl"
            onChange={handleFileSelect}
            onClick={(e) => e.stopPropagation()}
            className="hidden"
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <Spinner className="text-2xl" />
              <p className="text-sm text-gray-600 dark:text-gray-400">Uploading...</p>
            </div>
          ) : (
            <div>
              <svg className="mx-auto w-8 h-8 text-gray-400 dark:text-gray-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Upload your 3D model (.fbx, .obj, .abc, .usd, .ply, .stl) or drag and drop your file here
              </p>
            </div>
          )}
        </div>

        {/* Hidden input for re-uploading a newer version of a model —
            kept OUTSIDE the upload-area div so its programmatic click
            can't bubble into the upload area's onClick and open the
            new-model upload dialog instead. */}
        <input
          ref={reuploadInputRef}
          type="file"
          accept=".fbx,.obj,.abc,.usd,.ply,.stl"
          onChange={handleReuploadSelect}
          className="hidden"
        />

        {uploadError && (
          <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded text-xs text-center">
            {uploadError}
          </div>
        )}

        {/* Model list */}
        {models.length > 0 && (
          <div className="space-y-2">
            {models.map((model) => (
              <div
                key={model.id}
                className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <svg className="w-6 h-6 text-gray-400 dark:text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{model.filename}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {model.extension.toUpperCase()} - {formatFileSize(model.fileSize)}
                    </p>
                    {parsingModels[model.id] && (
                      <p className="text-xs text-purple-500 dark:text-purple-400 mt-0.5 flex items-center gap-1">
                        <Spinner className="text-xs" /> Extracting...
                      </p>
                    )}
                    {parseErrors[model.id] && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                        {parseErrors[model.id]}
                      </p>
                    )}
                    {meshData[model.id] && (
                      <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                        {meshData[model.id].meshes.length} mesh(es) - {formatTriangleCount(meshData[model.id].totalTriangles)} tris
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={(e) => handleReuploadClick(model, e)}
                    className="p-1.5 text-gray-500 hover:text-purple-600 dark:hover:text-purple-400 transition"
                    aria-label="Upload a newer version of this model"
                    title="Upload a newer version of this 3D model"
                  >
                    <Icon name="upload_file" className="text-base" />
                  </button>
                  <button
                    onClick={() => handleDeleteModelClick(model)}
                    className="p-1.5 text-gray-500 hover:text-red-600 dark:hover:text-red-400 transition"
                    aria-label="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}
