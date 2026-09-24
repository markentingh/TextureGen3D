import React, { useState, useRef, useEffect } from 'react';
import { useProject } from '@/context/project';
import { useHubGeneration } from './useHubGeneration';
import { Projects } from '@/api/user/projects';
import { ProjectMeshes } from '@/api/user/projectMeshes';
import { ProjectCameraAngles } from '@/api/user/projectCameraAngles';
import { OpenAI } from '@/api/admin/openai';
import ReferenceImagesSection from './ReferenceImagesSection';
import CameraAngleReferencesModal from './CameraAngleReferencesModal';
import { generateAngleThumbnail } from '@/helpers/camera-angle';
import { useModal } from '@/context/modal';
import Icon from '@/components/ui/icon';
import TextArea from '@/components/forms/textarea';
import Select from '@/components/forms/select';
import Input from '@/components/forms/input';
import ToggleButtons from '@/components/ui/toggle-buttons';

export default function GenerateImagesPanel({ showPanel, setShowPanel }) {
  const {
    id,
    token,
    models,
    selectedMesh,
    meshDbIds,
    cameraAngles,
    setCameraAngles,
    selectedAngleId,
    setSelectedAngleId,
    angleRefView,
    setAngleRefView,
    meshRefView,
    prompt,
    setPrompt,
    meshPrompts,
    setMeshPrompts,
    generationMode,
    setGenerationMode,
    projectRefs,
    setProjectRefs,
    imageModels,
    refImageModels,
    selectedModelId,
    setSelectedModelId,
    setProject,
    project,
    textureResolution,
    imageModelOptions,
    isComfyUI,
    isGradio,
    generating,
    setGenerating,
    comfyProgress,
    setComfyProgress,
    comfyMessage,
    setComfyMessage,
    generatingAngleIds,
    setGeneratingAngleIds,
    completedAngleIds,
    setCompletedAngleIds,
    layerThumbVersion,
    setLayerThumbVersion,
    setMaskThumbVersions,
    assetGeneratingLayerIds,
    setAssetGeneratingLayerIds,
    setLayerAssetsGenerating,
    meshLayers,
    addMeshLayer,
    prependMeshLayer,
    viewerRef,
    promptDebounceRef,
    layerApi,
    loadMeshLayers,
    refreshLayerTextures,
  } = useProject();
  const { showModal, hideModal } = useModal();

  const [currentGeneratingAngleId, setCurrentGeneratingAngleId] = useState(null);
  const seedDebounceRef = useRef(null);
  const { generateViaHub, removeBackground, activeHubConnectionRef } = useHubGeneration();
  const cancelRequestedRef = useRef(false);

  // ── Camera angle checkboxes (persisted to localStorage) ──
  const storageKey = `cameraAnglesUsed:${id}`;
  const [usedAngleIds, setUsedAngleIds] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) {
        const ids = stored.split(',').filter(Boolean);
        return new Set(ids);
      }
    } catch { /* ignore */ }
    return null; // null = not yet initialized (default to all checked)
  });

  // Sync usedAngleIds with cameraAngles: new angles are checked by default
  useEffect(() => {
    if (!cameraAngles.length) return;
    if (usedAngleIds === null) {
      // No localStorage — check all by default
      setUsedAngleIds(new Set(cameraAngles.map((a) => a.id)));
    } else {
      // Add any new angles that aren't in the set yet (checked by default)
      const newIds = cameraAngles.filter((a) => !usedAngleIds.has(a.id));
      if (newIds.length > 0) {
        setUsedAngleIds((prev) => {
          const next = new Set(prev);
          newIds.forEach((a) => next.add(a.id));
          return next;
        });
      }
    }
  }, [cameraAngles]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAngleUsed = (angleId) => {
    setUsedAngleIds((prev) => {
      const next = new Set(prev);
      if (next.has(angleId)) next.delete(angleId);
      else next.add(angleId);
      try {
        localStorage.setItem(storageKey, Array.from(next).join(','));
      } catch { /* ignore */ }
      return next;
    });
  };

  // ── Gradio server reachability — checked on Generate click only ──
  const [gradioOffline, setGradioOffline] = useState(false);

  // ── Cancel generation ──
  const handleCancelGeneration = async () => {
    cancelRequestedRef.current = true;
    const conn = activeHubConnectionRef.current;
    if (conn) {
      activeHubConnectionRef.current = null;
      try {
        // Fire-and-forget: don't await, since the server is busy with GenerateImage
        // and the GenerationError callback will fire once cancellation completes
        conn.invoke('CancelGeneration').catch(() => {});
      } catch { /* ignore */ }
      try {
        await conn.stop();
      } catch { /* ignore */ }
    }
    setGenerating(false);
    setGeneratingAngleIds(new Set());
    setCompletedAngleIds(new Set());
    setCurrentGeneratingAngleId(null);
    setComfyProgress(0);
    setComfyMessage('');
  };

  // ── handleImageModelChange ──
  const handleImageModelChange = async (e) => {
    const modelId = e.target.value;
    setSelectedModelId(modelId);
    setProject((prev) => (prev ? { ...prev, imageModelId: modelId } : prev));
    const selectedModel = imageModels.find((m) => m.id?.toString() === modelId);
    if (selectedModel?.modelKey) {
      localStorage.setItem('preferredImageModel', selectedModel.modelKey);
    }
    try {
      const projectsApi = Projects({ token });
      await projectsApi.updateImageModel({ id, imageModelId: modelId ? parseInt(modelId, 10) : null });
    } catch (err) {
      console.error('Failed to save preferred image model:', err);
    }
  };

  // ── handleSeedChange ──
  const handleSeedChange = (e) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    const val = raw === '' ? 0 : parseInt(raw, 10);
    setProject((prev) => prev ? { ...prev, seed: val } : prev);
    if (seedDebounceRef.current) clearTimeout(seedDebounceRef.current);
    seedDebounceRef.current = setTimeout(async () => {
      try {
        const projectsApi = Projects({ token });
        await projectsApi.updateSeed({ id, seed: val });
      } catch (err) {
        console.error('Failed to save seed:', err);
      }
    }, 2000);
  };

  // ── handleSeedKeyPress ──
  const handleSeedKeyPress = (e) => {
    if (!/[0-9]/.test(e.key) && e.key !== 'Backspace' && e.key !== 'Delete' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Tab') {
      e.preventDefault();
    }
  };

  // ── handlePromptChange ──
  const handlePromptChange = (e) => {
    const value = e.target.value;
    setPrompt(value);
    if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current);
    const meshDbId = selectedMesh ? meshDbIds[selectedMesh.key] : null;
    if (!meshDbId) return;

    if (generationMode === 'angles' && selectedAngleId) {
      promptDebounceRef.current = setTimeout(async () => {
        try {
          const anglesApi = ProjectCameraAngles({ token });
          await anglesApi.updatePrompt(id, selectedAngleId, value);
          setCameraAngles((prev) =>
            prev.map((a) => (a.id === selectedAngleId ? { ...a, prompt: value } : a))
          );
        } catch (err) {
          console.error('Failed to save angle prompt:', err);
        }
      }, 2000);
    } else {
      promptDebounceRef.current = setTimeout(async () => {
        try {
          const meshesApi = ProjectMeshes({ token });
          await meshesApi.updatePrompt(id, meshDbId, value);
          setMeshPrompts((prev) => ({ ...prev, [meshDbId]: value }));
        } catch (err) {
          console.error('Failed to save prompt:', err);
        }
      }, 2000);
    }
  };

  // ── handleAngleClick ──
  const handleAngleClick = (angle) => {
    setSelectedAngleId(angle.id);
    viewerRef.current?.setCameraRotation(angle.rotation);
    setPrompt(angle.prompt || '');
    if (angle.projectReferenceId) {
      const ref = projectRefs.find((r) => r.id === angle.projectReferenceId);
      setAngleRefView(ref ? [{ ...ref, active: true }] : []);
    } else {
      setAngleRefView([]);
    }
  };

  // ── handleGenerationModeChange ──
  const handleGenerationModeChange = (mode) => {
    setGenerationMode(mode);
    try {
      localStorage.setItem(`imageType:${id}`, mode === 'single' ? '0' : '1');
    } catch {
      /* ignore */
    }
    if (mode === 'single' && selectedMesh) {
      const meshDbId = meshDbIds[selectedMesh.key];
      setPrompt(meshPrompts[meshDbId] || '');
    } else if (mode === 'angles' && selectedAngleId) {
      const angle = cameraAngles.find((a) => a.id === selectedAngleId);
      setPrompt(angle?.prompt || '');
      if (angle?.projectReferenceId) {
        const ref = projectRefs.find((r) => r.id === angle.projectReferenceId);
        setAngleRefView(ref ? [{ ...ref, active: true }] : []);
      } else {
        setAngleRefView([]);
      }
    }
  };

  // ── handleAddCameraAngle ──
  const handleAddCameraAngle = async () => {
    if (!viewerRef.current || !selectedMesh) return;
    const thumb = viewerRef.current.captureThumbnail(75);
    const rotation = viewerRef.current.getCameraRotation();
    const meshDbId = meshDbIds[selectedMesh.key];
    if (meshDbId) {
      try {
        const anglesApi = ProjectCameraAngles({ token });
        const res = await anglesApi.create(id, {
          modelId: selectedMesh.modelId,
          meshId: meshDbId,
          rotation: JSON.stringify(rotation),
        });
        if (res.data.success) {
          const savedAngle = res.data.data;
          setCameraAngles((prev) => [
            ...prev,
            {
              id: savedAngle.id,
              dbId: savedAngle.id,
              thumbnail: thumb,
              rotation,
              prompt: savedAngle.prompt || '',
              projectReferenceId: savedAngle.projectReferenceId || null,
            },
          ]);
          if (cameraAngles.length === 0) {
            setSelectedAngleId(savedAngle.id);
            setPrompt(savedAngle.prompt || '');
            setAngleRefView([]);
          }
          return;
        }
      } catch {
        /* fall through to local-only */
      }
    }
    setCameraAngles((prev) => [
      ...prev,
      { id: Date.now(), thumbnail: thumb, rotation },
    ]);
  };

  // ── handleAddStandardAngles ──
  const doAddStandardAngles = async () => {
    if (!viewerRef.current || !selectedMesh) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;

    const standardAngles = [
      { name: 'Front', rotation: { x: 0, y: 0, z: 0 } },
      { name: 'Left', rotation: { x: 0, y: 90, z: 0 } },
      { name: 'Right', rotation: { x: 0, y: -90, z: 0 } },
      { name: 'Back', rotation: { x: 0, y: 180, z: 0 } },
      { name: 'Top', rotation: { x: -90, y: 0, z: 0 } },
      { name: 'Bottom', rotation: { x: 90, y: 0, z: 0 } },
    ];

    try {
      const anglesApi = ProjectCameraAngles({ token });
      await anglesApi.deleteAllByMesh(id, meshDbId);
      setCameraAngles([]);

      const newAngles = [];
      for (const angle of standardAngles) {
        const thumb = generateAngleThumbnail(selectedMesh?.object, angle.rotation, 75);
        const res = await anglesApi.create(id, {
          modelId: selectedMesh.modelId,
          meshId: meshDbId,
          rotation: JSON.stringify(angle.rotation),
        });
        if (res.data.success) {
          const saved = res.data.data;
          newAngles.push({
            id: saved.id,
            dbId: saved.id,
            thumbnail: thumb,
            rotation: angle.rotation,
            prompt: saved.prompt || '',
            projectReferenceId: saved.projectReferenceId || null,
          });
        }
      }

      setCameraAngles(newAngles);
      if (newAngles.length > 0) {
        setSelectedAngleId(newAngles[0].id);
        setPrompt(newAngles[0].prompt || '');
        setAngleRefView([]);
      }
    } catch (err) {
      console.error('Failed to add standard angles:', err);
    }
  };

  const handleAddStandardAngles = () => {
    if (cameraAngles.length === 0) {
      doAddStandardAngles();
    } else {
      showModal({
        title: 'Add Standard Angles',
        onClose: hideModal,
        body: (
          <>
            <p className="text-gray-700 dark:text-gray-300 mb-6">
              Adding standard angles will remove all of your existing camera angles. Do you really want to do this?
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
                  doAddStandardAngles();
                }}
                className="px-4 py-2 border-2 border-green-600 text-green-600 dark:text-green-400 dark:border-green-500 rounded-lg hover:bg-green-600 hover:text-white dark:hover:bg-green-600 dark:hover:text-white transition font-medium text-sm"
              >
                Add Standard Angles
              </button>
            </div>
          </>
        ),
      });
    }
  };

  // ── handleOpenCameraAngleReferences ──
  const handleOpenCameraAngleReferences = () => {
    showModal({
      title: 'Camera Angle References',
      className: 'max-w-[1000px]',
      onClose: hideModal,
      body: (
        <CameraAngleReferencesModal
          onClose={hideModal}
          projectId={id}
          token={token}
          cameraAngles={cameraAngles}
          selectedMesh={selectedMesh}
          meshDbIds={meshDbIds}
          refImageModels={refImageModels}
          projectRefs={projectRefs}
          setProjectRefs={setProjectRefs}
          setCameraAngles={setCameraAngles}
          setAngleRefView={setAngleRefView}
          selectedAngleId={selectedAngleId}
        />
      ),
    });
  };

  // ── handleRemoveCameraAngle ──
  const handleRemoveCameraAngle = async (angleId) => {
    const angle = cameraAngles.find((a) => a.id === angleId);
    const remaining = cameraAngles.filter((a) => a.id !== angleId);
    setCameraAngles(remaining);
    if (selectedAngleId === angleId) {
      if (remaining.length > 0) {
        setSelectedAngleId(remaining[0].id);
        setPrompt(remaining[0].prompt || '');
        if (remaining[0].projectReferenceId) {
          const ref = projectRefs.find((r) => r.id === remaining[0].projectReferenceId);
          setAngleRefView(ref ? [{ ...ref, active: true }] : []);
        } else {
          setAngleRefView([]);
        }
      } else {
        setSelectedAngleId(null);
        setAngleRefView([]);
      }
    }
    if (angle?.dbId) {
      try {
        const anglesApi = ProjectCameraAngles({ token });
        await anglesApi.delete(id, angle.dbId);
      } catch {
        /* ignore */
      }
    }
  };

  // ── handleGenerate ──
  const handleGenerate = async () => {
    if (!selectedMesh || !selectedModelId) return;
    if (generationMode === 'angles' && cameraAngles.length === 0) return;
    cancelRequestedRef.current = false;
    const activeRefs = generationMode === 'angles' ? angleRefView : meshRefView;
    // In angles mode, references are always considered active (no checkbox to toggle)
    const hasActiveRefs = generationMode === 'angles'
      ? activeRefs.length > 0
      : activeRefs.filter((r) => r.active).length > 0;
    if (!prompt.trim() && !hasActiveRefs) return;

    if (isGradio) {
      try {
        const { getGradioHealth } = OpenAI({ token });
        const res = await getGradioHealth();
        if (!res.data?.success) throw new Error('unreachable');
        setGradioOffline(false);
      } catch {
        setGradioOffline(true);
        return;
      }
    }

    setGenerating(true);
    setComfyProgress(0);
    setComfyMessage('');
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) {
      setGenerating(false);
      return;
    }

    try {
      if (generationMode === 'single') {
        const layerNum = meshLayers.length + 1;
        const cameraAngle = viewerRef.current?.getCameraAngle
          ? viewerRef.current.getCameraAngle()
          : null;
        const cameraAngleJson = cameraAngle ? JSON.stringify(cameraAngle) : '';
        const layerRes = await layerApi.create(id, meshDbId, `Layer ${layerNum}`, cameraAngleJson, false, meshRefView.find((r) => r.active)?.id ?? null);
        if (!layerRes.data?.success) throw new Error('Failed to create layer');
        const layer = layerRes.data.data;
        prependMeshLayer(meshDbId, layer);
        // New single-image layers go to the top of the stack — index 0 draws
        // last in the composite shader and renders first in the sidebar list.
        await layerApi.reorder(id, meshDbId, [layer.id, ...meshLayers.map((l) => l.id)]);
        setLayerAssetsGenerating(layer.id, true);

        // Camera-angle thumbnail — arbitrary angles don't match a stored
        // camera angle, so persist our own angle_thumb.png like inpaint does.
        const angleThumb = viewerRef.current?.captureThumbnail?.(75, cameraAngle);
        if (angleThumb) {
          try {
            await layerApi.saveAngleThumb(id, layer.id, meshDbId, angleThumb);
          } catch (err) {
            console.warn('Failed to save layer angle thumbnail:', err);
          }
        }

        // Use the captured camera angle — the user may rotate the mesh
        // while generation is in flight.
        const depthMap = viewerRef.current?.captureDepthMap(textureResolution, cameraAngle);
        if (!depthMap) throw new Error('Failed to generate depth map');

        const fullPrompt = meshPrompts[meshDbId] || '';

        let generatedImage;

        if (isComfyUI || isGradio) {
          const hubUrl = isComfyUI ? '/hubs/comfyui' : '/hubs/gradio';
          const hubName = isComfyUI ? 'ComfyUI' : 'Gradio';
          await layerApi.saveDepthMap(id, layer.id, meshDbId, depthMap);
          generatedImage = await generateViaHub({
            hubUrl,
            hubName,
            layer,
            meshDbId,
            fullPrompt,
          });
        } else {
          const genRes = await layerApi.generate(
            id,
            layer.id,
            meshDbId,
            parseInt(selectedModelId),
            fullPrompt,
            depthMap,
            cameraAngleJson,
            null,
            null,
            textureResolution
          );
          if (!genRes.data?.success)
            throw new Error(genRes.data?.message || 'Image generation failed');
          generatedImage = genRes.data.data?.image;
        }

        // Second pass: strip the background via the active type-4 model —
        // the processed image becomes the layer image + projection source.
        if (generatedImage) {
          generatedImage = await removeBackground({ generatedImage, layer, meshDbId, cameraAngleJson });
        }

        if (generatedImage) {
          const projectPromise = viewerRef.current?.projectImageToUvMap(
            generatedImage,
            cameraAngle,
            textureResolution
          );
          if (projectPromise) {
            const projected = await projectPromise;
            if (projected?.uvMap) {
              await layerApi.saveUvMap(id, layer.id, meshDbId, projected.uvMap);
            }
            // Coverage mask — white where the projection painted the UV map
            if (projected?.mask) {
              await layerApi.saveMasks(id, meshDbId, [{ layerId: layer.id, base64Mask: projected.mask }]);
              setMaskThumbVersions((prev) => ({ ...prev, [layer.id]: (prev[layer.id] || 0) + 1 }));
            }
          }
          const updatedLayers = await loadMeshLayers(meshDbId);
          await refreshLayerTextures(updatedLayers);
        }
        setLayerAssetsGenerating(layer.id, false);
      } else {
        const angles = [...cameraAngles].filter((a) => usedAngleIds?.has(a.id) ?? true);
        const totalAngles = angles.length;
        if (totalAngles === 0) {
          setGenerating(false);
          return;
        }
        setGeneratingAngleIds(new Set(angles.map((a) => a.id)));
        setCompletedAngleIds(new Set());

        // Capture the user's prompt before the loop — setSelectedAngleId during
        // the loop triggers an effect that overwrites `prompt` with the angle's prompt,
        // which we don't want to send to Gradio/ComfyUI.
        const userPrompt = prompt;

        for (let i = 0; i < totalAngles; i++) {
          if (cancelRequestedRef.current) break;

          const angle = angles[i];
          const angleNum = i + 1;

          setComfyProgress(0);
          setComfyMessage(`Image ${angleNum}/${totalAngles}: Starting...`);
          setCurrentGeneratingAngleId(angle.id);
          // Select this angle so its reference image shows in the Image References section
          setSelectedAngleId(angle.id);
          if (angle.projectReferenceId) {
            const ref = projectRefs.find((r) => r.id === angle.projectReferenceId);
            setAngleRefView(ref ? [{ ...ref, active: true }] : []);
          } else {
            setAngleRefView([]);
          }

          const layerNum = meshLayers.length + i + 1;
          const cameraAngleJson = JSON.stringify(angle.rotation);
          const layerRes = await layerApi.create(id, meshDbId, `Layer ${layerNum}`, cameraAngleJson, false, angle.projectReferenceId ?? null);
          if (!layerRes.data?.success)
            throw new Error(`Failed to create layer for angle ${angleNum}`);
          const layer = layerRes.data.data;
          addMeshLayer(meshDbId, layer);
          setLayerAssetsGenerating(layer.id, true);

          viewerRef.current?.setCameraRotation(angle.rotation);
          await new Promise((r) => setTimeout(r, 50));

          const depthMap = viewerRef.current?.captureDepthMap(textureResolution, angle.rotation);
          if (!depthMap)
            throw new Error(`Failed to generate depth map for angle ${angleNum}`);

          const fullPrompt = userPrompt;

          let generatedImage;

          if (isComfyUI || isGradio) {
            const hubUrl = isComfyUI ? '/hubs/comfyui' : '/hubs/gradio';
            const hubName = isComfyUI ? 'ComfyUI' : 'Gradio';
            await layerApi.saveDepthMap(id, layer.id, meshDbId, depthMap);
            generatedImage = await generateViaHub({
              hubUrl,
              hubName,
              layer,
              meshDbId,
              fullPrompt,
              angleId: angle.id,
              angleNum,
              totalAngles,
            });
          } else {
            setComfyMessage(`Image ${angleNum}/${totalAngles}: Generating...`);
            const genRes = await layerApi.generate(
              id,
              layer.id,
              meshDbId,
              parseInt(selectedModelId),
              fullPrompt,
              depthMap,
              cameraAngleJson,
              angle.id,
              null,
              textureResolution
            );
            if (!genRes.data?.success)
              throw new Error(
                genRes.data?.message || `Image generation failed for angle ${angleNum}`
              );
            generatedImage = genRes.data.data?.image;
          }

          if (cancelRequestedRef.current) break;

          // Second pass: strip the background via the active type-4 model
          if (generatedImage) {
            generatedImage = await removeBackground({ generatedImage, layer, meshDbId, cameraAngleJson });
          }

          if (generatedImage) {
            try {
              const projectPromise = viewerRef.current?.projectImageToUvMap(
                generatedImage,
                angle.rotation,
                textureResolution
              );
              if (projectPromise) {
                const projected = await projectPromise;
                if (projected?.uvMap) {
                  await layerApi.saveUvMap(id, layer.id, meshDbId, projected.uvMap);
                }
                if (projected?.mask) {
                  await layerApi.saveMasks(id, meshDbId, [{ layerId: layer.id, base64Mask: projected.mask }]);
                  setMaskThumbVersions((prev) => ({ ...prev, [layer.id]: (prev[layer.id] || 0) + 1 }));
                }
              }
            } catch (err) {
              console.error(`[Generate] Failed to project angle ${angleNum}:`, err);
            }
          }

          const updatedLayers = await loadMeshLayers(meshDbId);
          setLayerThumbVersion((v) => v + 1);
          await refreshLayerTextures(updatedLayers);
          setLayerAssetsGenerating(layer.id, false);

          setCompletedAngleIds((prev) => new Set(prev).add(angle.id));
          setComfyMessage(`Image ${angleNum}/${totalAngles}: Complete`);
        }
      }
    } catch (err) {
      console.error('Generation failed:', err);
    } finally {
      setGenerating(false);
      setComfyProgress(0);
      setComfyMessage('');
      setGeneratingAngleIds(new Set());
      setCompletedAngleIds(new Set());
      setCurrentGeneratingAngleId(null);
      // Safety net — clear any layer flags left set by an error/cancel
      setAssetGeneratingLayerIds(new Set());
    }
  };

  if (!showPanel || models.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 z-20 w-80 max-w-[calc(100vw-20rem)] bg-white/95 dark:bg-gray-800/95 backdrop-blur border-t border-r border-gray-200 dark:border-gray-700 rounded-tr-lg shadow-lg max-h-[calc(100vh-5em)] flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Generate Images</h3>
        <button
          onClick={() => setShowPanel(false)}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
          aria-label="Collapse panel"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {generationMode === 'angles' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Camera Angles</label>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleOpenCameraAngleReferences}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 leading-none"
                  title="Generate camera angle references"
                >
                  <Icon name="burst_mode" className="w-4 h-4 !text-[16px] !leading-4 block overflow-hidden" />
                </button>
                <button
                  onClick={handleAddStandardAngles}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 leading-none"
                  title="Add standard angles"
                >
                  <Icon name="360" className="w-4 h-4 !text-[16px] !leading-4 block overflow-hidden" />
                </button>
                <button
                  onClick={handleAddCameraAngle}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
                  title="Add angle"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
            </div>
            {cameraAngles.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">No camera angles added yet.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {cameraAngles.map((angle) => {
                  const isGenerating = generatingAngleIds.has(angle.id);
                  const isCompleted = completedAngleIds.has(angle.id);
                  return (
                    <div
                      key={angle.id}
                      onClick={() => handleAngleClick(angle)}
                      className={`relative group rounded-lg border overflow-hidden cursor-pointer transition ${selectedAngleId === angle.id ? 'border-purple-500 ring-2 ring-purple-500' : 'border-gray-200 dark:border-gray-600 hover:ring-2 hover:ring-purple-500'}`}
                      style={{ background: 'radial-gradient(circle at center, #2a2a5e, #1a1a2e)' }}
                    >
                      {/* Checkbox overlay (top-left) */}
                      <input
                        type="checkbox"
                        checked={usedAngleIds?.has(angle.id) ?? true}
                        onChange={(e) => { e.stopPropagation(); toggleAngleUsed(angle.id); }}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute top-1 left-1 z-10 w-4 h-4 cursor-pointer accent-purple-500"
                        title="Include in batch generation"
                      />
                      <div
                        className="w-full mt-2 aspect-square bg-center bg-cover bg-no-repeat"
                        style={{
                          backgroundImage: angle.thumbnail ? `url(${angle.thumbnail})` : undefined,
                        }}
                      />
                      {isGenerating && !isCompleted && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50" style={{ top: '8px', bottom: '20px' }}>
                          {currentGeneratingAngleId === angle.id && (
                            <Icon name="progress_activity" spin className="text-2xl text-white" />
                          )}
                        </div>
                      )}
                      <div className="px-1 py-0.5 text-center">
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight tabular-nums">
                          X:{Math.round(angle.rotation.x)}, Y:{Math.round(angle.rotation.y)}, Z:{Math.round(angle.rotation.z)}
                        </p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRemoveCameraAngle(angle.id); }}
                        className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition hover:bg-red-600"
                        aria-label="Remove camera angle"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div>
          <ToggleButtons
            value={generationMode}
            onChange={handleGenerationModeChange}
            options={[
              { value: 'single', label: 'Single Image' },
              { value: 'angles', label: 'Camera Angles' },
            ]}
          />

          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mt-2 mb-1">Prompt</label>
          <TextArea
            value={prompt}
            onChange={handlePromptChange}
            placeholder="Describe the texture..."
            rows={4}
          />
        </div>

        <ReferenceImagesSection angleMode={generationMode === 'angles'} maxRefs={generationMode === 'single' ? 1 : 0} />

        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Projection Image Model</label>
          <Select
            value={selectedModelId}
            onChange={handleImageModelChange}
            options={imageModelOptions}
          />
        </div>
      </div>

      <div className="p-3 border-t border-gray-200 dark:border-gray-700">
        {generating && (
          <div className="mb-2">
            <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
              <span>{comfyMessage || 'Generating...'}</span>
              <span>{comfyProgress}%</span>
            </div>
            <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all duration-300 rounded-full"
                style={{ width: `${comfyProgress}%` }}
              />
            </div>
          </div>
        )}
        {isGradio && gradioOffline && (
          <div className="mb-2 px-3 py-2 rounded-lg bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs font-medium text-center">
            Gradio server is non-responsive
          </div>
        )}
        <div className="flex gap-2">
          <Input
            type="number"
            name="seed"
            value={project?.seed ?? 0}
            onChange={handleSeedChange}
            onKeyPress={handleSeedKeyPress}
            formPadding={false}
            className="w-[6em]"
            placeholder="Seed"
            title="Seed value for image generation"
          />
          <button
            onClick={handleGenerate}
            disabled={generating || !selectedMesh || (generationMode === 'angles' && (cameraAngles.length === 0 || (usedAngleIds?.size ?? cameraAngles.length) === 0)) || (!prompt.trim() && (generationMode === 'angles' ? angleRefView.length === 0 : meshRefView.filter((r) => r.active).length === 0)) || !selectedModelId}
            className="flex-1 px-4 py-2 border-2 border-green-600 text-green-600 dark:text-green-500 dark:border-green-500 rounded-lg hover:bg-green-600 hover:text-white dark:hover:bg-green-600 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm"
          >
            {generating ? 'Generating...' : (generationMode === 'angles' ? 'Generate Images' : 'Generate Image')}
          </button>
          {generating && (
            <button
              onClick={handleCancelGeneration}
              className="flex-shrink-0 px-3 py-2 border-2 border-red-600 text-red-600 dark:text-red-500 dark:border-red-500 rounded-lg hover:bg-red-600 hover:text-white dark:hover:bg-red-600 dark:hover:text-white transition font-medium text-sm"
              title="Cancel generation"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
