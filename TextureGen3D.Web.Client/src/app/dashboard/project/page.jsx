import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useSession } from '@/context/session';
import { Projects } from '@/api/user/projects';
import { ProjectModels } from '@/api/user/projectModels';
import { ImageGeneration } from '@/api/user/imageGeneration';
import { parseModel, formatTriangleCount } from '@/utils/modelParser';
import ModelViewer from '@/components/viewer/ModelViewer';
import TextArea from '@/components/forms/textarea';
import Select from '@/components/forms/select';
import Spinner from '@/components/ui/spinner';

export default function ProjectDetailsPage() {
  const { id } = useParams();
  const { token, logout } = useSession();
  const [project, setProject] = useState(null);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [showPanel, setShowPanel] = useState(true);
  const fileInputRef = useRef(null);

  // Extracted mesh data keyed by modelId
  const [meshData, setMeshData] = useState({});
  const [parsingModels, setParsingModels] = useState({});
  const [parseErrors, setParseErrors] = useState({});

  // Currently selected mesh for canvas rendering
  const [selectedMesh, setSelectedMesh] = useState(null);

  // Generate Images section
  const viewerRef = useRef(null);
  const [cameraAngles, setCameraAngles] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [imageModels, setImageModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [generating, setGenerating] = useState(false);

  const loadProject = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const api = Projects({ token });
      const res = await api.getById(id);
      if (res.data.success) {
        setProject(res.data.data);
      } else {
        setError(res.data.message || 'Failed to load project');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  const loadModels = useCallback(async () => {
    try {
      const api = ProjectModels({ token });
      const res = await api.getByProject(id);
      if (res.data.success) {
        const loadedModels = res.data.data || [];
        setModels(loadedModels);
        // Parse each model that hasn't been parsed yet
        for (const model of loadedModels) {
          if (!meshData[model.id] && !parsingModels[model.id]) {
            downloadAndParseModel(model);
          }
        }
      }
    } catch (err) {
      // models load failure is non-fatal
    }
  }, [id, token, meshData, parsingModels]);

  useEffect(() => {
    loadProject();
    loadModels();
    // Load available image generation models
    ImageGeneration({ token }).getActiveModels()
      .then((res) => {
        if (res.data.success) {
          setImageModels(res.data.data || []);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  const handleAddCameraAngle = () => {
    if (!viewerRef.current || !selectedMesh) return;
    const thumb = viewerRef.current.captureThumbnail(75);
    const rotation = viewerRef.current.getCameraRotation();
    setCameraAngles((prev) => [...prev, {
      id: Date.now(),
      thumbnail: thumb,
      rotation,
    }]);
  };

  const handleRemoveCameraAngle = (angleId) => {
    setCameraAngles((prev) => prev.filter((a) => a.id !== angleId));
  };

  const handleGenerate = () => {
    if (!prompt.trim() || cameraAngles.length === 0) return;
    setGenerating(true);
    // TODO: call the image generation API with the prompt, camera angles, and selected model
    setTimeout(() => setGenerating(false), 1000);
  };

  /**
   * Download a model file from the server and parse it to extract meshes.
   */
  const downloadAndParseModel = async (model) => {
    setParsingModels((prev) => ({ ...prev, [model.id]: true }));
    setParseErrors((prev) => {
      const next = { ...prev };
      delete next[model.id];
      return next;
    });

    try {
      const downloadUrl = ProjectModels({ token }).downloadUrl(id, model.id);
      const response = await fetch(downloadUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      const result = await parseModel(model.filename, buffer);

      setMeshData((prev) => ({
        ...prev,
        [model.id]: result,
      }));
    } catch (err) {
      setParseErrors((prev) => ({
        ...prev,
        [model.id]: err.message || 'Failed to parse model',
      }));
    } finally {
      setParsingModels((prev) => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });
    }
  };

  /**
   * Parse a freshly uploaded file directly from the File object
   * (avoids re-downloading it from the server).
   */
  const parseUploadedFile = async (modelId, file) => {
    setParsingModels((prev) => ({ ...prev, [modelId]: true }));
    try {
      const buffer = await file.arrayBuffer();
      const result = await parseModel(file.name, buffer);
      setMeshData((prev) => ({
        ...prev,
        [modelId]: result,
      }));
    } catch (err) {
      setParseErrors((prev) => ({
        ...prev,
        [modelId]: err.message || 'Failed to parse model',
      }));
    } finally {
      setParsingModels((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
    }
  };

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

  const handleDeleteModel = async (modelId) => {
    if (!confirm('Delete this model?')) return;
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
        // Clear selection if the deleted model's mesh was selected
        if (selectedMesh && selectedMesh.modelId === modelId) {
          setSelectedMesh(null);
        }
        await loadModels();
      }
    } catch (err) {
      alert(err.response?.data?.message || err.message || 'Delete failed');
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // Collect all meshes across all models for the right sidebar
  const allMeshes = [];
  for (const model of models) {
    const data = meshData[model.id];
    if (data) {
      for (let i = 0; i < data.meshes.length; i++) {
        const mesh = data.meshes[i];
        allMeshes.push({
          ...mesh,
          modelId: model.id,
          modelFilename: model.filename,
          meshIndex: i,
          key: `${model.id}-${i}`,
        });
      }
    }
  }

  const handleMeshSelect = (mesh) => {
    setSelectedMesh(mesh);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner className="text-4xl" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-gray-900 text-gray-100">
      {/* Three.js canvas (with integrated rotation gizmo) — reserves space for right sidebar */}
      <div className="absolute top-0 left-0 bottom-0 right-72">
        <ModelViewer ref={viewerRef} selectedMesh={selectedMesh} />
      </div>

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
      {!showPanel && (
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

      {/* Right sidebar - Mesh list */}
      <aside className="fixed top-0 right-0 z-20 h-screen w-72 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Meshes</h3>
        </div>
        <div className="flex-1 overflow-y-auto">
          {allMeshes.length === 0 ? (
            <div className="p-4 text-sm text-gray-400 dark:text-gray-500 text-center">
              {models.length === 0
                ? 'No models uploaded yet.'
                : Object.keys(parsingModels).length > 0
                  ? 'Parsing models...'
                  : 'No meshes extracted.'}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {allMeshes.map((mesh) => {
                const isSelected = selectedMesh?.key === mesh.key;
                return (
                  <li
                    key={mesh.key}
                    onClick={() => handleMeshSelect(mesh)}
                    className={`flex items-center justify-between px-4 py-3 cursor-pointer transition ${
                      isSelected
                        ? 'bg-purple-50 dark:bg-purple-900/30 outline-none ring-2 ring-purple-500 ring-inset'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                    style={isSelected ? { boxShadow: 'inset 0 0 0 2px #a855f7' } : undefined}
                  >
                    <div className="min-w-0 flex-1 mr-3">
                      <p className={`font-bold text-sm truncate ${
                        isSelected
                          ? 'text-purple-700 dark:text-purple-300'
                          : 'text-gray-900 dark:text-gray-100'
                      }`}>
                        {mesh.name}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 tabular-nums">
                      {mesh.triangles.toLocaleString()} tris
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {allMeshes.length > 0 && (
          <div className="p-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
            <div className="flex justify-between">
              <span>Total meshes:</span>
              <span className="font-medium tabular-nums">{allMeshes.length}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span>Total triangles:</span>
              <span className="font-medium tabular-nums">{formatTriangleCount(allMeshes.reduce((s, m) => s + m.triangles, 0))}</span>
            </div>
          </div>
        )}
      </aside>

      {/* Bottom panel - Generate Images + Upload area + model list */}
      {showPanel && (
        <div className="fixed bottom-0 left-0 z-20 w-80 max-w-[calc(100vw-20rem)] bg-white/95 dark:bg-gray-800/95 backdrop-blur border-t border-r border-gray-200 dark:border-gray-700 rounded-tr-lg shadow-lg max-h-[60vh] flex flex-col">
          <div className="p-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Models</h3>
            <button
              onClick={() => setShowPanel(false)}
              className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition"
              aria-label="Collapse panel"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {/* Generate Images section */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Generate Images</h4>

              {/* Camera Angles subsection */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Camera Angles</span>
                  <button
                    onClick={handleAddCameraAngle}
                    disabled={!selectedMesh}
                    className="p-1 rounded text-gray-500 hover:text-purple-600 dark:hover:text-purple-400 disabled:opacity-30 disabled:cursor-not-allowed transition"
                    aria-label="Add camera angle"
                    title={selectedMesh ? 'Add current camera angle' : 'Select a mesh first'}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
                {cameraAngles.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">
                    {selectedMesh ? 'Click + to add the current camera angle' : 'Select a mesh first'}
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {cameraAngles.map((angle) => (
                      <div
                        key={angle.id}
                        className="relative group rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden bg-gray-100 dark:bg-gray-700"
                      >
                        <div
                          className="w-full aspect-square bg-center bg-cover bg-no-repeat"
                          style={{
                            backgroundImage: angle.thumbnail ? `url(${angle.thumbnail})` : undefined,
                            backgroundColor: '#1a1a2e',
                          }}
                        />
                        <div className="px-1 py-0.5 text-center">
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight tabular-nums">
                            X:{angle.rotation.x} Y:{angle.rotation.y} Z:{angle.rotation.z}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRemoveCameraAngle(angle.id)}
                          className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition hover:bg-red-600"
                          aria-label="Remove camera angle"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Prompt subsection */}
              <div>
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Prompt</span>
                <TextArea
                  name="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe the texture you want to generate..."
                  autoResize={true}
                  rows={2}
                  className="mb-0"
                />
              </div>

              {/* Model select */}
              <div>
                <Select
                  name="imageModel"
                  value={selectedModelId}
                  onChange={(e) => setSelectedModelId(e.target.value)}
                  placeholder="Select an image model"
                  options={imageModels.map((m) => ({ value: m.id?.toString() || m.modelKey || m.name, label: m.name || m.model || m.modelKey }))}
                  className="mb-0"
                />
              </div>

              {/* Generate button */}
              <button
                onClick={handleGenerate}
                disabled={generating || !prompt.trim() || cameraAngles.length === 0 || !selectedModelId}
                className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm"
              >
                {generating ? 'Generating...' : 'Generate'}
              </button>
            </div>

            {/* Divider */}
            <div className="border-t border-gray-200 dark:border-gray-700" />

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
                      <a
                        href={ProjectModels({ token }).downloadUrl(id, model.id)}
                        className="p-1.5 text-gray-500 hover:text-purple-600 dark:hover:text-purple-400 transition"
                        aria-label="Download"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </a>
                      <button
                        onClick={() => handleDeleteModel(model.id)}
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
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-30 max-w-md p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg shadow-lg">
          {error}
        </div>
      )}
    </div>
  );
}
