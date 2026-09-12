import React, { useState, useRef, useCallback } from 'react';
import * as signalR from '@microsoft/signalr';
import { useProject } from '@/context/project';
import { Projects } from '@/api/user/projects';
import { ProjectMeshes } from '@/api/user/projectMeshes';
import { ProjectCameraAngles } from '@/api/user/projectCameraAngles';
import { ProjectMeshReferences } from '@/api/user/projectMeshReferences';
import { ProjectReferences } from '@/api/user/projectReferences';
import ReferenceCell from './ReferenceCell';
import ReferenceModal from './ReferenceModal';
import ProjectReferencesModal from './ProjectReferencesModal';
import Icon from '@/components/ui/icon';
import TextArea from '@/components/forms/textarea';
import Select from '@/components/forms/select';
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
    setMeshRefView,
    prompt,
    setPrompt,
    meshPrompts,
    setMeshPrompts,
    generationMode,
    setGenerationMode,
    projectRefs,
    setProjectRefs,
    meshReferences,
    setMeshReferences,
    imageModels,
    refImageModels,
    selectedModelId,
    setSelectedModelId,
    setProject,
    imageModelOptions,
    isComfyUI,
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
    meshLayers,
    viewerRef,
    promptDebounceRef,
    layerApi,
    loadMeshLayers,
    refreshLayerTextures,
    refreshMeshRefView,
  } = useProject();

  const [refModal, setRefModal] = useState(null);
  const [projectRefsModal, setProjectRefsModal] = useState(false);
  const [currentGeneratingAngleId, setCurrentGeneratingAngleId] = useState(null);

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
      await projectsApi.updateImageModel({ id, imageModelId: modelId || null });
    } catch (err) {
      console.error('Failed to save preferred image model:', err);
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
  const handleAddStandardAngles = async () => {
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
        const thumb = viewerRef.current.captureThumbnail(75, angle.rotation);
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
    const activeRefs = generationMode === 'angles' ? angleRefView : meshRefView;
    if (!prompt.trim() && activeRefs.filter((r) => r.active).length === 0) return;

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
        const layerRes = await layerApi.create(id, meshDbId, `Layer ${layerNum}`);
        if (!layerRes.data?.success) throw new Error('Failed to create layer');
        const layer = layerRes.data.data;

        const depthMap = viewerRef.current?.captureDepthMap(1024);
        if (!depthMap) throw new Error('Failed to generate depth map');

        const cameraAngle = viewerRef.current?.getCameraAngle
          ? viewerRef.current.getCameraAngle()
          : null;
        const cameraAngleJson = cameraAngle ? JSON.stringify(cameraAngle) : '';

        const fullPrompt = `Apply the image references to a 3D model using the provided depth map. The first image is a depth map of the 3D model from the current camera angle. Remove all shadows, reflections, highlights, and specularity. Maintain absolute pixel-per-pixel structural identity, shape, and spatial alignment with the original image, displaying only raw base color. Flat albedo texture map, completely unlit, diffuse-only illumination, uniform exposure, no directional light.\n\n${meshPrompts[meshDbId] || ''}`;

        let generatedImage;

        if (isComfyUI) {
          await layerApi.saveDepthMap(id, layer.id, meshDbId, depthMap);
          generatedImage = await new Promise((resolve, reject) => {
            const connection = new signalR.HubConnectionBuilder()
              .withUrl('/hubs/comfyui', { accessTokenFactory: () => token })
              .withAutomaticReconnect()
              .configureLogging(signalR.LogLevel.Warning)
              .withServerTimeout(1000 * 60 * 60)
              .withKeepAliveInterval(15000)
              .build();

            connection.on('ProgressUpdate', (value, message) => {
              setComfyProgress(value);
              if (message) setComfyMessage(message);
            });
            connection.on('GenerationComplete', async (base64Image) => {
              try {
                const saveRes = await layerApi.saveComfyUiResult(
                  id,
                  layer.id,
                  meshDbId,
                  base64Image
                );
                if (!saveRes.data?.success) throw new Error('Failed to save ComfyUI result');
                await connection.stop();
                resolve(base64Image);
              } catch (err) {
                await connection.stop();
                reject(err);
              }
            });
            connection.on('GenerationError', async (errorMsg, stackTrace) => {
              console.error('ComfyUI Generation Error:', errorMsg);
              if (stackTrace) console.error('Stack trace:', stackTrace);
              await connection.stop();
              reject(new Error(errorMsg));
            });
            connection
              .start()
              .then(() =>
                connection.invoke(
                  'GenerateImage',
                  parseInt(selectedModelId),
                  fullPrompt,
                  id,
                  meshDbId,
                  layer.id
                )
              )
              .catch((err) => {
                connection.stop();
                reject(err);
              });
          });
        } else {
          const genRes = await layerApi.generate(
            id,
            layer.id,
            meshDbId,
            parseInt(selectedModelId),
            fullPrompt,
            depthMap,
            cameraAngleJson
          );
          if (!genRes.data?.success)
            throw new Error(genRes.data?.message || 'Image generation failed');
          generatedImage = genRes.data.data?.image;
        }

        if (generatedImage) {
          const uvMapPromise = viewerRef.current?.projectImageToUvMap(
            generatedImage,
            null,
            1024
          );
          if (uvMapPromise) {
            const uvMapDataUrl = await uvMapPromise;
            if (uvMapDataUrl) {
              await layerApi.saveUvMap(id, layer.id, meshDbId, uvMapDataUrl);
            }
          }
          const updatedLayers = await loadMeshLayers(meshDbId);
          await refreshLayerTextures(updatedLayers);
        }
      } else {
        const angles = [...cameraAngles];
        const totalAngles = angles.length;
        setGeneratingAngleIds(new Set(angles.map((a) => a.id)));
        setCompletedAngleIds(new Set());

        for (let i = 0; i < totalAngles; i++) {
          const angle = angles[i];
          const angleNum = i + 1;

          setComfyProgress(0);
          setComfyMessage(`Image ${angleNum}/${totalAngles}: Starting...`);
          setCurrentGeneratingAngleId(angle.id);

          const layerNum = meshLayers.length + i + 1;
          const layerRes = await layerApi.create(id, meshDbId, `Layer ${layerNum}`);
          if (!layerRes.data?.success)
            throw new Error(`Failed to create layer for angle ${angleNum}`);
          const layer = layerRes.data.data;

          viewerRef.current?.setCameraRotation(angle.rotation);
          await new Promise((r) => setTimeout(r, 50));

          const depthMap = viewerRef.current?.captureDepthMap(1024, angle.rotation);
          if (!depthMap)
            throw new Error(`Failed to generate depth map for angle ${angleNum}`);

          const cameraAngleJson = JSON.stringify(angle.rotation);
          const fullPrompt = `${prompt}\n\nApply the image references to a 3D model using the provided depth map. The first image is a depth map of the 3D model from the current camera angle. Remove all shadows, reflections, highlights, and specularity. Maintain absolute pixel-per-pixel structural identity, shape, and spatial alignment with the original image, displaying only raw base color. Flat albedo texture map, completely unlit, diffuse-only illumination, uniform exposure, no directional light.`;

          let generatedImage;

          if (isComfyUI) {
            await layerApi.saveDepthMap(id, layer.id, meshDbId, depthMap);
            generatedImage = await new Promise((resolve, reject) => {
              const connection = new signalR.HubConnectionBuilder()
                .withUrl('/hubs/comfyui', { accessTokenFactory: () => token })
                .withAutomaticReconnect()
                .configureLogging(signalR.LogLevel.Warning)
                .withServerTimeout(600000)
                .withKeepAliveInterval(15000)
                .build();

              connection.on('ProgressUpdate', (value, message) => {
                setComfyProgress(value);
                setComfyMessage(
                  `Image ${angleNum}/${totalAngles}: ${message || 'Generating...'}`
                );
              });
              connection.on('GenerationComplete', async (base64Image) => {
                try {
                  const saveRes = await layerApi.saveComfyUiResult(
                    id,
                    layer.id,
                    meshDbId,
                    base64Image
                  );
                  if (!saveRes.data?.success)
                    throw new Error('Failed to save ComfyUI result');
                  await connection.stop();
                  resolve(base64Image);
                } catch (err) {
                  await connection.stop();
                  reject(err);
                }
              });
              connection.on('GenerationError', async (errorMsg, stackTrace) => {
                console.error(`ComfyUI Generation Error (angle ${angleNum}):`, errorMsg);
                if (stackTrace) console.error('Stack trace:', stackTrace);
                await connection.stop();
                reject(new Error(errorMsg));
              });
              connection
                .start()
                .then(() =>
                  connection.invoke(
                    'GenerateImage',
                    parseInt(selectedModelId),
                    fullPrompt,
                    id,
                    meshDbId,
                    layer.id,
                    angle.id
                  )
                )
                .catch((err) => {
                  connection.stop();
                  reject(err);
                });
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
              angle.id
            );
            if (!genRes.data?.success)
              throw new Error(
                genRes.data?.message || `Image generation failed for angle ${angleNum}`
              );
            generatedImage = genRes.data.data?.image;
          }

          if (generatedImage) {
            try {
              const uvMapPromise = viewerRef.current?.projectImageToUvMap(
                generatedImage,
                angle.rotation,
                1024
              );
              if (uvMapPromise) {
                const uvMapDataUrl = await uvMapPromise;
                if (uvMapDataUrl) {
                  await layerApi.saveUvMap(id, layer.id, meshDbId, uvMapDataUrl);
                }
              }
            } catch (err) {
              console.error(`[Generate] Failed to project angle ${angleNum}:`, err);
            }
          }

          const updatedLayers = await loadMeshLayers(meshDbId);
          setLayerThumbVersion((v) => v + 1);
          await refreshLayerTextures(updatedLayers);

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
    }
  };

  // ── Reference handlers ──
  const handleRefDelete = async (ref) => {
    if (!ref.meshRefId) return;
    try {
      const meshRefApi = ProjectMeshReferences({ token });
      await meshRefApi.delete(id, ref.meshRefId);
      const meshDbId = selectedMesh ? meshDbIds[selectedMesh.key] : null;
      if (meshDbId) {
        setMeshReferences((prev) => ({
          ...prev,
          [meshDbId]: (prev[meshDbId] || []).filter(
            (mr) => mr.projectReferenceId !== ref.id
          ),
        }));
      }
      setMeshRefView((prev) => prev.filter((r) => r.id !== ref.id));
    } catch (err) {
      console.error('Failed to remove reference from mesh:', err);
    }
  };

  const handleRefToggleActive = async (ref) => {
    if (!ref.meshRefId) return;
    const newActive = !ref.active;
    setMeshRefView((prev) =>
      prev.map((r) => (r.id === ref.id ? { ...r, active: newActive } : r))
    );
    try {
      const meshRefApi = ProjectMeshReferences({ token });
      await meshRefApi.updateActive(id, ref.meshRefId, newActive);
    } catch (err) {
      setMeshRefView((prev) =>
        prev.map((r) => (r.id === ref.id ? { ...r, active: !newActive } : r))
      );
      console.error('Failed to update reference active state:', err);
    }
  };

  const handleModalMeshRefChanged = async () => {
    if (!selectedMesh) return;
    const meshDbId = meshDbIds[selectedMesh.key];
    if (!meshDbId) return;
    try {
      const meshRefApi = ProjectMeshReferences({ token });
      const res = await meshRefApi.getByMesh(id, meshDbId);
      if (res.data?.success) {
        setMeshReferences((prev) => ({ ...prev, [meshDbId]: res.data.data || [] }));
      }
    } catch {
      /* ignore */
    }
  };

  const handleModalProjectRefsChanged = async () => {
    try {
      const refApi = ProjectReferences({ token });
      const res = await refApi.getByProject(id);
      if (res.data?.success) {
        setProjectRefs(res.data.data || []);
      }
    } catch {
      /* ignore */
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
                  onClick={handleAddStandardAngles}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
                  title="Add standard angles"
                >
                  <Icon name="360" className="w-4 h-4" />
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

        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Image References</label>
          <div className={`grid grid-cols-3 gap-x-1 gap-y-3 p-1 rounded-lg w-fit transition`}>
            {(generationMode === 'angles' ? angleRefView : meshRefView).map((ref) => (
              <ReferenceCell
                key={ref.id}
                ref_={ref}
                projectId={id}
                token={token}
                onToggleActive={() => handleRefToggleActive(ref)}
                onDelete={() => {
                  if (generationMode === 'angles' && selectedAngleId) {
                    (async () => {
                      try {
                        const anglesApi = ProjectCameraAngles({ token });
                        await anglesApi.updateReference(id, selectedAngleId, null);
                        setCameraAngles((prev) => prev.map((a) => a.id === selectedAngleId ? { ...a, projectReferenceId: null } : a));
                        setAngleRefView([]);
                      } catch (err) {
                        console.error('Failed to remove reference from camera angle:', err);
                      }
                    })();
                  } else {
                    handleRefDelete(ref);
                  }
                }}
                onNewImage={() => setRefModal({ reference: ref, mode: 'new', isAngleRef: generationMode === 'angles', angleId: selectedAngleId })}
                onEditImage={() => setRefModal({ reference: ref, mode: 'edit' })}
              />
            ))}
            {(generationMode === 'single' || angleRefView.length === 0) && (
              <div
                onClick={() => setProjectRefsModal(true)}
                className={`relative border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition border-gray-300 dark:border-gray-600 hover:border-purple-400 dark:hover:border-purple-500`}
                style={{ width: 100, height: 80 }}
              >
                <>
                  <svg className="w-5 h-5 text-gray-400 dark:text-gray-500 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span className="text-[8px] text-gray-400 dark:text-gray-500 text-center leading-tight px-1">Add</span>
                </>
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Model</label>
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
        <button
          onClick={handleGenerate}
          disabled={generating || !selectedMesh || (generationMode === 'angles' && cameraAngles.length === 0) || (!prompt.trim() && (generationMode === 'angles' ? angleRefView : meshRefView).filter((r) => r.active).length === 0) || !selectedModelId}
          className="w-full px-4 py-2 border-2 border-green-600 text-green-600 dark:text-green-500 dark:border-green-500 rounded-lg hover:bg-green-600 hover:text-white dark:hover:bg-green-600 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm"
        >
          {generating ? 'Generating...' : (generationMode === 'angles' ? 'Generate Images' : 'Generate Image')}
        </button>
      </div>

      {refModal && (
        <ReferenceModal
          reference={refModal.reference}
          projectId={id}
          token={token}
          imageModels={refImageModels}
          mode={refModal.mode}
          onClose={() => setRefModal(null)}
          onSaved={async (savedRef) => {
            await handleModalProjectRefsChanged();
            refreshMeshRefView();
            if (refModal.isAngleRef && refModal.angleId && savedRef?.id) {
              try {
                const anglesApi = ProjectCameraAngles({ token });
                await anglesApi.updateReference(id, refModal.angleId, savedRef.id);
                setCameraAngles((prev) => prev.map((a) => a.id === refModal.angleId ? { ...a, projectReferenceId: savedRef.id } : a));
                setAngleRefView([{ ...savedRef, active: true }]);
              } catch (err) {
                console.error('Failed to update camera angle reference:', err);
              }
            }
          }}
        />
      )}

      {projectRefsModal && (
        <ProjectReferencesModal
          projectId={id}
          token={token}
          meshId={selectedMesh ? meshDbIds[selectedMesh.key] : null}
          cameraAngleMode={generationMode === 'angles' && !!selectedAngleId}
          selectedRefId={generationMode === 'angles' ? (cameraAngles.find((a) => a.id === selectedAngleId)?.projectReferenceId || null) : null}
          onSelectReference={async (refId) => {
            if (!selectedAngleId) return;
            try {
              const anglesApi = ProjectCameraAngles({ token });
              await anglesApi.updateReference(id, selectedAngleId, refId);
              setCameraAngles((prev) => prev.map((a) => a.id === selectedAngleId ? { ...a, projectReferenceId: refId } : a));
              const ref = projectRefs.find((r) => r.id === refId);
              setAngleRefView(ref ? [{ ...ref, active: true }] : []);
              setProjectRefsModal(false);
            } catch (err) {
              console.error('Failed to set camera angle reference:', err);
            }
          }}
          onClose={() => setProjectRefsModal(false)}
          onAdded={handleModalMeshRefChanged}
          onDeleted={handleModalMeshRefChanged}
          onProjectReferencesChanged={async () => {
            await handleModalProjectRefsChanged();
            handleModalMeshRefChanged();
          }}
        />
      )}
    </div>
  );
}
