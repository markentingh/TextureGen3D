import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { ProjectCameraAngles } from '@/api/user/projectCameraAngles';
import { ProjectReferences } from '@/api/user/projectReferences';
import ProjectReferencesModal from './ProjectReferencesModal';
import Modal from '@/components/ui/modal';
import Select from '@/components/forms/select';
import Icon from '@/components/ui/icon';
import Spinner from '@/components/ui/spinner';
import Button from '@/components/ui/button';
import { generateAngleThumbnail } from '@/helpers/camera-angle';

const THUMB_SIZE = 150;
const GEN_SIZE = 512;

// Convert a data URL into just the raw base64 payload
function dataUrlToBase64(dataUrl) {
  const idx = dataUrl.indexOf(',');
  return idx >= 0 ? dataUrl.substring(idx + 1) : dataUrl;
}

export default function CameraAngleReferencesModal({
  onClose,
  projectId,
  token,
  cameraAngles,
  selectedMesh,
  meshDbIds,
  refImageModels,
  projectRefs,
  setProjectRefs,
  setCameraAngles,
  setAngleRefView,
  selectedAngleId,
}) {
  const [selectedReferenceId, setSelectedReferenceId] = useState(() => {
    try {
      const saved = localStorage.getItem(`cameraAnglesRefId:${projectId}`);
      return saved || null;
    } catch {
      return null;
    }
  });
  const [selectedModelId, setSelectedModelId] = useState('');
  const [prompt, setPrompt] = useState(() => {
    try {
      return localStorage.getItem(`cameraAnglesPrompt:${projectId}`) || '';
    } catch {
      return '';
    }
  });
  const [generating, setGenerating] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [completedIds, setCompletedIds] = useState(new Set());
  const [generatedThumbs, setGeneratedThumbs] = useState({}); // angleId -> cache-busted thumb URL
  const [generatedRefIds, setGeneratedRefIds] = useState({}); // angleId -> project reference ID
  const [singleGeneratingId, setSingleGeneratingId] = useState(null); // angleId being generated individually
  const [previewImage, setPreviewImage] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [showRefPicker, setShowRefPicker] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState(null);

  const anglesApi = useMemo(() => ProjectCameraAngles({ token }), [token]);
  const refApi = useMemo(() => ProjectReferences({ token }), [token]);

  // Image model options — same set used by the Add/Edit Image (Reference) modal
  const imageModelOptions = useMemo(
    () =>
      refImageModels.map((m) => ({
        value: m.id?.toString() || m.modelKey || m.name,
        label: m.name || m.model || m.modelKey,
      })),
    [refImageModels]
  );

  const selectedReference = useMemo(
    () => projectRefs.find((r) => r.id === selectedReferenceId) || null,
    [projectRefs, selectedReferenceId]
  );

  // Auto-select the first image model when the dropdown becomes visible
  // (after a reference is selected), matching ReferenceModal's behavior.
  useEffect(() => {
    if (selectedReference && !selectedModelId && refImageModels.length > 0) {
      setSelectedModelId(
        refImageModels[0].id?.toString() || refImageModels[0].modelKey || refImageModels[0].name
      );
    }
  }, [selectedReference, selectedModelId, refImageModels]);

  // Clear stale preview when reference or model changes (not on prompt typing)
  useEffect(() => {
    setPreviewResult(null);
  }, [selectedReferenceId, selectedModelId]);

  // Keyboard navigation for the preview carousel
  useEffect(() => {
    if (!previewImage || previewImage.completedList.length <= 1) return;
    const handler = (e) => {
      const total = previewImage.completedList.length;
      if (e.key === 'ArrowLeft') {
        setPreviewImage((prev) => ({ ...prev, index: (prev.index - 1 + total) % total }));
      } else if (e.key === 'ArrowRight') {
        setPreviewImage((prev) => ({ ...prev, index: (prev.index + 1) % total }));
      } else if (e.key === 'Escape') {
        setPreviewImage(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewImage]);

  const openProjectReferences = () => {
    setShowRefPicker(true);
  };

  const closeProjectReferences = () => {
    setShowRefPicker(false);
  };

  const handleSelectReference = (refId) => {
    setSelectedReferenceId(refId);
    setShowRefPicker(false);
    try {
      if (refId) localStorage.setItem(`cameraAnglesRefId:${projectId}`, refId);
    } catch { /* ignore */ }
  };

  const savePromptToStorage = () => {
    try {
      localStorage.setItem(`cameraAnglesPrompt:${projectId}`, prompt);
    } catch { /* ignore */ }
  };

  const handlePreviewGenerate = async () => {
    if (!selectedReferenceId || !selectedModelId || cameraAngles.length === 0) return;
    savePromptToStorage();
    setPreviewing(true);
    setError('');
    setPreviewResult(null);
    try {
      const angle = cameraAngles[0];
      const thumb512 = generateAngleThumbnail(selectedMesh?.object, angle.rotation, GEN_SIZE);
      if (!thumb512) throw new Error('Failed to capture camera angle thumbnail');
      const base64 = dataUrlToBase64(thumb512);
      const res = await anglesApi.previewReference(
        projectId,
        angle.id,
        selectedReferenceId,
        selectedModelId,
        base64,
        prompt
      );
      if (!res.data?.success || !res.data?.data?.image) {
        throw new Error(res.data?.message || 'Preview generation failed');
      }
      setPreviewResult(`data:image/png;base64,${res.data.data.image}`);
    } catch (err) {
      console.error('Preview generation failed:', err);
      setError(err.message || 'Preview generation failed');
    } finally {
      setPreviewing(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedReferenceId || !selectedModelId || cameraAngles.length === 0) return;
    savePromptToStorage();
    setGenerating(true);
    setError('');
    setDone(false);
    setCompletedIds(new Set());
    setPreviewResult(null);

    let hadError = false;
    const total = cameraAngles.length;
    for (let i = 0; i < total; i++) {
      const angle = cameraAngles[i];
      setCurrentIdx(i);
      try {
        // Regenerate the camera-angle thumbnail at 512x512 from the mesh
        const thumb512 = generateAngleThumbnail(selectedMesh?.object, angle.rotation, GEN_SIZE);
        if (!thumb512) throw new Error('Failed to capture camera angle thumbnail');

        const base64 = dataUrlToBase64(thumb512);
        const res = await anglesApi.generateReference(
          projectId,
          angle.id,
          selectedReferenceId,
          selectedModelId,
          base64,
          prompt
        );
        if (!res.data?.success) {
          throw new Error(res.data?.message || 'Generation failed');
        }

        // Use the returned referenceId to build the project reference thumb URL
        const newRefId = res.data?.data?.referenceId;
        const thumbUrl = newRefId
          ? `${refApi.thumbUrl(projectId, newRefId)}?t=${Date.now()}`
          : null;
        setGeneratedThumbs((prev) => ({ ...prev, [angle.id]: thumbUrl }));
        if (newRefId) setGeneratedRefIds((prev) => ({ ...prev, [angle.id]: newRefId }));
        setCompletedIds((prev) => new Set(prev).add(angle.id));
      } catch (err) {
        console.error(`Failed to generate reference for angle ${i + 1}:`, err);
        setError(err.message || `Failed to generate reference image ${i + 1}`);
        hadError = true;
        break;
      }
    }

    setCurrentIdx(-1);
    setGenerating(false);
    if (!hadError) {
      setDone(true);

      // Update each camera angle's projectReferenceId to the newly generated
      // project reference so the GenerateImagesPanel's Image References section
      // reflects the new reference image for each angle.
      if (setCameraAngles) {
        setCameraAngles((prev) =>
          prev.map((a) => {
            const newRefId = generatedRefIds[a.id];
            return newRefId ? { ...a, projectReferenceId: newRefId } : a;
          })
        );
      }

      // Refresh projectRefs from the API so the new references are available
      // for lookup by GenerateImagesPanel's handleAngleClick and angleRefView.
      let refreshedRefs = projectRefs;
      if (setProjectRefs) {
        try {
          const res = await refApi.getByProject(projectId);
          if (res.data?.success) {
            refreshedRefs = res.data.data || [];
            setProjectRefs(refreshedRefs);
          }
        } catch (err) {
          console.error('Failed to refresh project references:', err);
        }
      }

      // If the GenerateImagesPanel has a selected angle, update its ref view
      if (setAngleRefView && selectedAngleId) {
        const newRefId = generatedRefIds[selectedAngleId];
        if (newRefId) {
          // Look up the ref from the freshly-fetched projectRefs (or fallback)
          let ref = refreshedRefs.find((r) => r.id === newRefId);
          if (!ref) {
            ref = { id: newRefId, projectId, filename: `CameraAngle_${selectedAngleId}`, extension: 'png', active: true };
          }
          setAngleRefView([{ ...ref, active: true }]);
        }
      }
    }
  };

  const handleGenerateSingle = async (angle) => {
    if (!selectedReferenceId || !selectedModelId || singleGeneratingId) return;
    savePromptToStorage();
    setSingleGeneratingId(angle.id);
    setError('');
    try {
      const thumb512 = generateAngleThumbnail(selectedMesh?.object, angle.rotation, GEN_SIZE);
      if (!thumb512) throw new Error('Failed to capture camera angle thumbnail');
      const base64 = dataUrlToBase64(thumb512);
      const res = await anglesApi.generateReference(
        projectId,
        angle.id,
        selectedReferenceId,
        selectedModelId,
        base64,
        prompt
      );
      if (!res.data?.success) {
        throw new Error(res.data?.message || 'Generation failed');
      }
      const newRefId = res.data?.data?.referenceId;
      const thumbUrl = newRefId
        ? `${refApi.thumbUrl(projectId, newRefId)}?t=${Date.now()}`
        : null;
      setGeneratedThumbs((prev) => ({ ...prev, [angle.id]: thumbUrl }));
      if (newRefId) setGeneratedRefIds((prev) => ({ ...prev, [angle.id]: newRefId }));
      setCompletedIds((prev) => new Set(prev).add(angle.id));

      // Update the camera angle's projectReferenceId in the parent state
      if (setCameraAngles && newRefId) {
        setCameraAngles((prev) =>
          prev.map((a) => (a.id === angle.id ? { ...a, projectReferenceId: newRefId } : a))
        );
      }
      // Refresh projectRefs so the new reference is available for lookup
      if (setProjectRefs) {
        try {
          const refRes = await refApi.getByProject(projectId);
          if (refRes.data?.success) {
            setProjectRefs(refRes.data.data || []);
          }
        } catch (err) {
          console.error('Failed to refresh project references:', err);
        }
      }
      // Update the selected angle's ref view if this is the selected angle
      if (setAngleRefView && selectedAngleId === angle.id && newRefId) {
        let ref = (await refApi.getByProject(projectId)).data?.data?.find((r) => r.id === newRefId);
        if (!ref) ref = { id: newRefId, projectId, filename: `CameraAngle_${angle.id}`, extension: 'png', active: true };
        setAngleRefView([{ ...ref, active: true }]);
      }
    } catch (err) {
      console.error('Failed to generate reference for angle:', err);
      setError(err.message || 'Failed to generate reference image');
    } finally {
      setSingleGeneratingId(null);
    }
  };

  const handlePreview = useCallback((angleId) => {
    // Build the ordered list of completed angle IDs from the grid
    const completedList = cameraAngles.filter((a) => completedIds.has(a.id));
    const idx = completedList.findIndex((a) => a.id === angleId);
    setPreviewImage({
      angleId,
      completedList,
      index: idx >= 0 ? idx : 0,
    });
  }, [cameraAngles, completedIds]);

  const progressPercent = cameraAngles.length > 0
    ? Math.round((completedIds.size / cameraAngles.length) * 100)
    : 0;

  return (
    <div className="space-y-4 w-full max-w-[900px]">
      {/* Explanation */}
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Select or upload a reference image below. It will be used to generate a reference image for each camera angle.
      </p>

      {/* Camera angles grid */}
      <div className="grid grid-cols-4 gap-3">
        {cameraAngles.map((angle, i) => {
          const generatedThumb = generatedThumbs[angle.id];
          const isCurrent = generating && i === currentIdx;
          const isPending = generating && i !== currentIdx && !completedIds.has(angle.id);
          const isCompleted = completedIds.has(angle.id);
          const isSingleGenerating = singleGeneratingId === angle.id;
          const canGenerateSingle = !generating && !isSingleGenerating && !done && selectedReference && selectedModelId;
          return (
            <div
              key={angle.id}
              onClick={() => isCompleted && handlePreview(angle.id)}
              className={`group relative rounded-lg border overflow-hidden transition ${
                isCompleted ? 'cursor-pointer border-green-500 hover:ring-2 hover:ring-green-500' : 'border-gray-200 dark:border-gray-600'
              } ${!isCompleted ? 'cursor-default' : ''}`}
              style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
            >
              <div
                className="w-full h-full bg-center bg-cover bg-no-repeat"
                style={{
                  backgroundImage: generatedThumb
                    ? `url(${generatedThumb})`
                    : angle.thumbnail
                    ? `url(${angle.thumbnail})`
                    : undefined,
                  backgroundColor: '#1a1a2e',
                }}
              />
              {(isPending || isCurrent || isSingleGenerating) && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  {(isCurrent || isSingleGenerating) && <Spinner className="text-2xl text-white" />}
                </div>
              )}
              {/* Generate Image button on hover */}
              {canGenerateSingle && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition">
                  <Button
                    color="green"
                    size="small"
                    onClick={(e) => { e.stopPropagation(); handleGenerateSingle(angle); }}
                  >
                    Generate Image
                  </Button>
                </div>
              )}
              <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/60 text-center">
                <p className="text-[9px] text-white leading-tight tabular-nums">
                  X:{Math.round(angle.rotation.x)}, Y:{Math.round(angle.rotation.y)}, Z:{Math.round(angle.rotation.z)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected reference image + Image Model dropdown + Prompt textarea */}
      {!done && selectedReference && (
        <div className="flex items-start gap-4">
          <img
            src={refApi.thumbUrl(projectId, selectedReference.id)}
            alt="Selected reference"
            className="rounded-lg border border-gray-200 dark:border-gray-600 object-cover flex-shrink-0"
            style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
          />
          <div className="flex-1 space-y-2">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Image Model</label>
              <Select
                name="imageModel"
                value={selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
                options={imageModelOptions}
                fitContent
                className="mb-0"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Optional prompt to append to the generation..."
                rows={3}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>
      )}

      {/* Progress bar + message */}
      {generating && (
        <div>
          <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
            <span>Generating reference image {currentIdx + 1}/{cameraAngles.length}...</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all duration-300 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Success message */}
      {done && (
        <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm">
          All camera angle references have been generated and saved.
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="p-2 rounded bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Preview result */}
      {previewResult && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Preview (first camera angle)</p>
          <div className="flex justify-center">
            <img
              src={previewResult}
              alt="Preview"
              className="rounded-lg border border-gray-200 dark:border-gray-600 max-w-full max-h-[400px] object-contain"
            />
          </div>
        </div>
      )}

      {/* Bottom action buttons */}
      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium rounded-lg border-2 border-gray-400 text-gray-600 dark:text-gray-300 dark:border-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
        >
          Cancel
        </button>
        {!done && (
          <button
            onClick={openProjectReferences}
            disabled={generating || previewing}
            className="px-4 py-2 text-sm font-medium rounded-lg border-2 border-blue-600 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Select Reference Image
          </button>
        )}
        {!done && selectedReference && (
          <button
            onClick={handlePreviewGenerate}
            disabled={!selectedModelId || cameraAngles.length === 0 || generating || previewing}
            className="px-4 py-2 text-sm font-medium rounded-lg border-2 border-green-600 text-green-600 dark:text-green-400 dark:border-green-500 hover:bg-green-600 hover:text-white dark:hover:bg-green-600 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {previewing ? 'Previewing...' : 'Preview'}
          </button>
        )}
        {!generating && !done && selectedReference && (
          <button
            onClick={handleGenerate}
            disabled={!selectedModelId || cameraAngles.length === 0 || previewing}
            className="px-4 py-2 text-sm font-medium rounded-lg border-2 border-green-600 text-green-600 dark:text-green-400 dark:border-green-500 hover:bg-green-600 hover:text-white dark:hover:bg-green-600 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Generate Reference Images
          </button>
        )}
      </div>

      {/* Full-size preview carousel */}
      {previewImage && previewImage.completedList.length > 0 && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewImage(null)}
        >
          {(() => {
            const current = previewImage.completedList[previewImage.index];
            const refId = generatedRefIds[current.id];
            const url = refId
              ? `${refApi.imageUrl(projectId, refId)}?t=${Date.now()}`
              : '';
            const total = previewImage.completedList.length;
            const goPrev = () => setPreviewImage((prev) => ({ ...prev, index: (prev.index - 1 + total) % total }));
            const goNext = () => setPreviewImage((prev) => ({ ...prev, index: (prev.index + 1) % total }));
            return (
              <>
                <img
                  src={url}
                  alt="Generated reference"
                  className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
                  onClick={(e) => e.stopPropagation()}
                />
                {total > 1 && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); goPrev(); }}
                      className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/20 text-white hover:bg-white/30"
                      aria-label="Previous"
                    >
                      <Icon name="chevron_left" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); goNext(); }}
                      className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/20 text-white hover:bg-white/30"
                      aria-label="Next"
                    >
                      <Icon name="chevron_right" />
                    </button>
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-white/20 text-white text-sm">
                      {previewImage.index + 1} / {total}
                    </div>
                  </>
                )}
              </>
            );
          })()}
          <button
            onClick={() => setPreviewImage(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/20 text-white hover:bg-white/30"
            aria-label="Close preview"
          >
            <Icon name="close" />
          </button>
        </div>
      )}

      {/* Inline Project References picker — rendered as a stacked modal so the
          parent Camera Angle References modal stays mounted underneath. */}
      {showRefPicker && (
        <Modal
          title="Project References"
          className="max-w-[1200px]"
          onClose={closeProjectReferences}
        >
          <ProjectReferencesModal
            projectId={projectId}
            token={token}
            meshId={selectedMesh ? meshDbIds[selectedMesh.key] : null}
            cameraAngleMode
            selectedRefId={selectedReferenceId}
            onSelectReference={handleSelectReference}
            onClose={closeProjectReferences}
            onProjectReferencesChanged={async () => {
              try {
                const res = await refApi.getByProject(projectId);
                if (res.data?.success) setProjectRefs(res.data.data || []);
              } catch { /* ignore */ }
            }}
          />
        </Modal>
      )}
    </div>
  );
}
