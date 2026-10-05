import React, { useRef, useCallback, useEffect } from 'react';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { generateAngleThumbnails } from '@/helpers/camera-angle';
import { useProject } from '@/context/project';
import { ProjectMeshes } from '@/api/user/projectMeshes';
import Icon from '@/components/ui/icon';
import { useModal } from '@/context/modal';

export default function MeshList() {
  const {
    id,
    token,
    loading,
    models,
    meshData,
    parseErrors,
    parsingModels,
    allMeshes,
    selectedMesh,
    setSelectedMesh,
    meshDbIds,
    auxVisibleIds,
    toggleAuxMesh,
    meshPrompts,
    setPrompt,
    loadMeshLayers,
    allCameraAngles,
    thumbnailCache,
    setThumbnailCache,
    setCameraAngles,
    setSelectedAngleId,
    generationMode,
    projectRefs,
    setAngleRefView,
    loadProject,
    meshesCollapsed,
    setMeshesCollapsed,
  } = useProject();
  const { showModal, hideModal } = useModal();

  // ── handleMeshDownload ──
  const handleMeshDownload = useCallback(
    async (mesh, event) => {
      event.stopPropagation();
      if (!mesh?.object) return;

      const exporter = new GLTFExporter();
      const clone = mesh.object.clone(true);

      exporter.parse(
        clone,
        (result) => {
          const blob = new Blob([result], { type: 'model/gltf-binary' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${(mesh.name || 'mesh').replace(/[^a-zA-Z0-9_-]/g, '_')}.glb`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        },
        (error) => {
          console.error('GLB export failed:', error);
        },
        { binary: true }
      );
    },
    []
  );

  // ── handleMeshSelect ──
  const handleMeshSelect = useCallback(
    async (mesh) => {
      setSelectedMesh(mesh);
      const meshDbId = meshDbIds[mesh.key];
      if (meshDbId) {
        setPrompt(meshPrompts[meshDbId] || '');
      } else {
        setPrompt('');
      }

      loadMeshLayers(meshDbId);

      if (meshDbId) {
        const savedAngles = allCameraAngles[meshDbId] || [];
        const cached = thumbnailCache[mesh.key] || {};
        const anglesNeedingThumbs = savedAngles.filter((a) => !cached[a.id]);
        const newThumbs =
          anglesNeedingThumbs.length > 0
            ? await generateAngleThumbnails(mesh, anglesNeedingThumbs)
            : [];

        const thumbMap = { ...cached };
        anglesNeedingThumbs.forEach((angle, i) => {
          thumbMap[angle.id] = newThumbs[i];
        });

        if (anglesNeedingThumbs.length > 0) {
          setThumbnailCache((prev) => ({ ...prev, [mesh.key]: thumbMap }));
        }

        const mappedAngles = savedAngles.map((angle) => ({
          id: angle.id,
          dbId: angle.id,
          thumbnail: thumbMap[angle.id] || null,
          rotation: JSON.parse(angle.rotation || '{}'),
          prompt: angle.prompt || '',
          projectReferenceId: angle.projectReferenceId || null,
        }));
        setCameraAngles(mappedAngles);
        if (mappedAngles.length > 0) {
          setSelectedAngleId(mappedAngles[0].id);
          if (generationMode === 'angles') {
            setPrompt(mappedAngles[0].prompt || '');
          }
          if (mappedAngles[0].projectReferenceId) {
            const ref = projectRefs.find((r) => r.id === mappedAngles[0].projectReferenceId);
            setAngleRefView(ref ? [{ ...ref, active: true }] : []);
          } else {
            setAngleRefView([]);
          }
        } else {
          setSelectedAngleId(null);
          setAngleRefView([]);
        }
        return;
      }
      setCameraAngles([]);
    },
    [
      meshDbIds,
      meshPrompts,
      setPrompt,
      loadMeshLayers,
      allCameraAngles,
      thumbnailCache,
      setThumbnailCache,
      setCameraAngles,
      setSelectedAngleId,
      generationMode,
      projectRefs,
      setAngleRefView,
      setSelectedMesh,
    ]
  );

  // Select a mesh when mesh data becomes available — the persisted
  // selection (selectedMesh:{projectId}) wins, else the first mesh.
  // Models download and parse one-by-one, so the saved mesh's model may
  // not be in allMeshes yet — keep waiting for the list to grow rather
  // than falling back to the first mesh of the first-parsed model.
  useEffect(() => {
    if (selectedMesh || allMeshes.length === 0) return;
    let savedKey = null;
    try {
      savedKey = localStorage.getItem(`selectedMesh:${id}`);
    } catch { /* storage unavailable — default pick */ }
    if (savedKey) {
      const found = allMeshes.find((m) => m.key === savedKey);
      if (found) {
        handleMeshSelect(found);
        return;
      }
      // Still waiting on models that haven't parsed or failed yet.
      const stillParsing =
        loading || models.some((m) => !meshData[m.id] && !parseErrors?.[m.id]);
      if (stillParsing) return;
    }
    handleMeshSelect(allMeshes[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMeshes, selectedMesh, loading, models, meshData, parseErrors]);

  // Persist the selected mesh so a page refresh restores it (mesh.key is
  // `{modelId}-{index}` — stable across reloads). Cleared when nothing is
  // selected (e.g. the mesh was deleted) — but only after a selection has
  // existed this session, so the mount-time null doesn't wipe the saved
  // key before the restore effect can read it.
  const didSelectRef = useRef(false);
  useEffect(() => {
    if (!id) return;
    if (selectedMesh?.key) didSelectRef.current = true;
    if (!didSelectRef.current) return;
    try {
      if (selectedMesh?.key) localStorage.setItem(`selectedMesh:${id}`, selectedMesh.key);
      else localStorage.removeItem(`selectedMesh:${id}`);
    } catch { /* non-fatal */ }
  }, [id, selectedMesh]);

  // ── handleDeleteMeshClick / handleDeleteMesh ──
  const handleDeleteMeshClick = (mesh, e) => {
    e.stopPropagation();
    showModal({
      title: 'Delete Mesh',
      onClose: hideModal,
      body: (
        <>
          <p className="text-gray-700 dark:text-gray-300 mb-6">
            Do you really want to delete the mesh "{mesh.name}"? Its layers will be deleted as well.
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
                handleDeleteMesh(mesh);
              }}
              className="px-4 py-2 border-2 border-red-600 text-red-600 dark:text-red-400 dark:border-red-500 rounded-lg hover:bg-red-600 hover:text-white dark:hover:bg-red-600 dark:hover:text-white transition font-medium text-sm"
            >
              Delete Mesh
            </button>
          </div>
        </>
      ),
    });
  };

  const handleDeleteMesh = async (mesh) => {
    const meshDbId = meshDbIds[mesh.key];
    if (!meshDbId) return;
    try {
      const api = ProjectMeshes({ token });
      const res = await api.delete(id, meshDbId);
      if (res.data.success) {
        if (selectedMesh?.key === mesh.key) {
          setSelectedMesh(null);
        }
        await loadProject();
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  return (
    <>
      {/* Meshes accordion title — same chevron pattern as Project
          Settings; collapsed state persists in ui:{projectId} */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Meshes</h3>
        <button
          onClick={() => setMeshesCollapsed((v) => !v)}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
          aria-label={meshesCollapsed ? 'Expand meshes' : 'Collapse meshes'}
        >
          <svg
            className={`w-4 h-4 transition-transform ${meshesCollapsed ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
      {/* Meshes list */}
      {meshesCollapsed ? null : allMeshes.length === 0 ? (
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
            const isAuxVisible = auxVisibleIds.includes(meshDbIds[mesh.key]);
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
                {isSelected ? (
                  <span
                    className="p-1 flex-shrink-0 text-purple-600 dark:text-purple-400"
                    title="Selected mesh"
                    aria-label="Selected mesh"
                  >
                    <Icon name="deployed_code" className="text-base" />
                  </span>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleAuxMesh(mesh);
                    }}
                    className={`p-1 rounded transition flex-shrink-0 ${
                      isAuxVisible
                        ? 'text-purple-600 dark:text-purple-400'
                        : 'text-gray-400 hover:text-purple-600 dark:hover:text-purple-400'
                    }`}
                    aria-label={isAuxVisible ? 'Hide mesh in canvas' : 'Show mesh in canvas'}
                    title={isAuxVisible ? 'Hide mesh in canvas' : 'Show mesh in canvas'}
                  >
                    <Icon name={isAuxVisible ? 'visibility' : 'visibility_off'} className="text-base" />
                  </button>
                )}
                <div className="min-w-0 flex-1 ml-1 mr-3">
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
                <button
                  onClick={(e) => handleMeshDownload(mesh, e)}
                  className="ml-2 p-1 rounded text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition flex-shrink-0"
                  aria-label="Download mesh as GLB"
                  title="Download mesh as GLB"
                >
                  <Icon name="download" className="text-base" />
                </button>
                <button
                  onClick={(e) => handleDeleteMeshClick(mesh, e)}
                  className="p-1 rounded text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition flex-shrink-0"
                  aria-label="Delete mesh"
                  title="Delete mesh and its layers"
                >
                  <Icon name="delete" className="text-base" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
