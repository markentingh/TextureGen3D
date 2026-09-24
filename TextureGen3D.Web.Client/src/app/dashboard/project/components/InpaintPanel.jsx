import React, { useEffect, useState } from 'react';
import { useProject } from '@/context/project';
import { useHubGeneration } from './useHubGeneration';
import ReferenceImagesSection from './ReferenceImagesSection';
import TextArea from '@/components/forms/textarea';
import Select from '@/components/forms/select';
import Icon from '@/components/ui/icon';

// Write the mask (white = painted) into the image's alpha channel.
// Painted regions become transparent — what the OpenAI image-edit
// API treats as the area to regenerate.
function applyMaskToAlpha(imageDataUrl, maskDataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const mask = new Image();
      mask.onload = () => {
        const w = img.width;
        const h = img.height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = w;
        maskCanvas.height = h;
        const maskCtx = maskCanvas.getContext('2d');
        maskCtx.drawImage(mask, 0, 0, w, h);

        const imgData = ctx.getImageData(0, 0, w, h);
        const maskData = maskCtx.getImageData(0, 0, w, h);
        for (let i = 0; i < imgData.data.length; i += 4) {
          const luma = maskData.data[i] * 0.299 + maskData.data[i + 1] * 0.587 + maskData.data[i + 2] * 0.114;
          imgData.data[i + 3] = 255 - luma;
        }
        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      mask.onerror = reject;
      mask.src = maskDataUrl;
    };
    img.onerror = reject;
    img.src = imageDataUrl;
  });
}



export default function InpaintPanel({ showPanel, setShowPanel }) {
  const {
    id,
    token,
    models,
    selectedMesh,
    meshDbIds,
    meshRefView,
    meshLayers,
    inpaintPrompt,
    setInpaintPrompt,
    inpaintMaskVisible,
    setInpaintMaskVisible,
    inpaintImageModels,
    inpaintModelId,
    setInpaintModelId,
    inpaintModelOptions,
    allImageModels,
    isComfyUI,
    isGradio,
    textureResolution,
    viewerRef,
    layerApi,
    prependMeshLayer,
    loadMeshLayers,
    refreshLayerTextures,
    generating,
    setGenerating,
    comfyProgress,
    setComfyProgress,
    comfyMessage,
    setComfyMessage,
    setLayerThumbVersion,
    setMaskThumbVersions,
    setLayerAssetsGenerating,
  } = useProject();
  const { generateViaHub, removeBackground } = useHubGeneration();
  const [useDepthStep, setUseDepthStep] = useState(
    () => localStorage.getItem('inpaintUseDepthStep') !== '0'
  );

  // Sync the eye toggle with the shader overlay
  useEffect(() => {
    viewerRef.current?.setInpaintMaskVisible?.(inpaintMaskVisible);
  }, [inpaintMaskVisible, viewerRef]);

  if (!showPanel || models.length === 0) return null;

  const handleInpaintModelChange = (e) => {
    const modelId = e.target.value;
    setInpaintModelId(modelId);
    const selectedModel = inpaintImageModels.find((m) => m.id?.toString() === modelId);
    if (selectedModel?.modelKey) {
      localStorage.setItem('preferredInpaintModel', selectedModel.modelKey);
    }
  };

  const handleInpaint = async () => {
    if (generating) return;
    const meshDbId = selectedMesh ? meshDbIds[selectedMesh.key] : null;
    if (!meshDbId) return;

    setGenerating(true);
    setComfyProgress(0);
    setComfyMessage('Capturing view...');
    let newLayerId = null; // tracked so the assets spinner clears on error too

    try {
      const cameraAngle = viewerRef.current?.getCameraAngle?.();
      const cameraAngleJson = cameraAngle ? JSON.stringify(cameraAngle) : '';

      // 1+2 — unlit composite (white bg, no overlay) + raw inpaint mask
      const composite = viewerRef.current?.captureCompositeImage?.(textureResolution);
      const maskImage = viewerRef.current?.captureInpaintMaskImage?.(textureResolution);
      if (!composite || !maskImage) throw new Error('Failed to capture inpaint inputs');

      // 3 — inverted mask → alpha channel of the composite
      const maskedImage = await applyMaskToAlpha(composite, maskImage);

      // 4 — inpaint edit: composite is InputImages[0], masked RGBA is InputMask,
      // active mesh references are appended to InputImages
      setComfyProgress(15);
      setComfyMessage('Inpainting...');
      const referenceIds = meshRefView.filter((r) => r.active).map((r) => r.id);
      const inpRes = await layerApi.inpaint(
        id,
        meshDbId,
        composite,
        maskedImage,
        inpaintPrompt,
        referenceIds,
        parseInt(inpaintModelId),
        textureResolution
      );
      if (!inpRes.data?.success) throw new Error(inpRes.data?.message || 'Inpaint failed');
      const inpaintedImage = inpRes.data.data?.image;
      if (!inpaintedImage) throw new Error('No image returned from inpaint');

      // 5 — same projection pipeline as the Generate Images panel: new layer,
      // depth map, projection model (type 1) → texture, project to UV map
      setComfyProgress(60);
      setComfyMessage('Projecting onto new layer...');
      const layerNum = meshLayers.length + 1;
      const layerRes = await layerApi.create(id, meshDbId, `Layer ${layerNum}`, cameraAngleJson, true, referenceIds[0] ?? null);
      if (!layerRes.data?.success) throw new Error('Failed to create layer');
      const layer = layerRes.data.data;
      prependMeshLayer(meshDbId, layer);
      newLayerId = layer.id;
      setLayerAssetsGenerating(layer.id, true);
      // New inpaint layers go to the top of the stack — index 0 draws last
      // in the composite shader and renders first in the sidebar list.
      await layerApi.reorder(id, meshDbId, [layer.id, ...meshLayers.map((l) => l.id)]);

      // Camera-angle thumbnail for the layer row — arbitrary inpaint angles
      // don't match a stored camera angle, so persist our own angle_thumb.png
      const angleThumb = viewerRef.current?.captureThumbnail?.(75, cameraAngle);
      if (angleThumb) {
        try {
          await layerApi.saveAngleThumb(id, layer.id, meshDbId, angleThumb);
        } catch (err) {
          console.warn('Failed to save layer angle thumbnail:', err);
        }
      }

      setComfyProgress(75);
      let generatedImage;
      if (useDepthStep) {
        // Depth map must match the captured camera angle, not the live
        // camera — the user may have rotated the mesh mid-inpaint.
        const depthMap = viewerRef.current?.captureDepthMap(textureResolution, cameraAngle);
        if (!depthMap) throw new Error('Failed to generate depth map');

        // Projection always runs through the first active Depth to Image
        // (type 1) model in the ImageGeneration table — no dropdown.
        const projectionModel = (allImageModels || []).find((m) => m.type === 1 && m.active !== false);
        if (!projectionModel) throw new Error('No Depth to Image model configured');

        setComfyMessage('Generating projection...');
        if (isComfyUI || isGradio) {
          // Same path as the Generate Images panel — the hub reads the depth map
          // from storage and reports progress over SignalR
          const hubUrl = isComfyUI ? '/hubs/comfyui' : '/hubs/gradio';
          const hubName = isComfyUI ? 'ComfyUI' : 'Gradio';
          await layerApi.saveDepthMap(id, layer.id, meshDbId, depthMap);
          generatedImage = await generateViaHub({
            hubUrl,
            hubName,
            layer,
            meshDbId,
            fullPrompt: inpaintPrompt,
            inputImage: inpaintedImage,
            imageModelId: projectionModel.id,
          });
        } else {
          const genRes = await layerApi.generate(
            id,
            layer.id,
            meshDbId,
            projectionModel.id,
            inpaintPrompt,
            depthMap,
            cameraAngleJson,
            null,
            inpaintedImage,
            textureResolution
          );
          if (!genRes.data?.success) throw new Error(genRes.data?.message || 'Projection generation failed');
          generatedImage = genRes.data.data?.image;
        }
      } else {
        // Depth step skipped — the inpaint model's output goes straight
        // through the background-removal model.
        generatedImage = inpaintedImage;
      }

      // Second pass: strip the background via the active type-4 model —
      // the processed image becomes the projection source.
      if (generatedImage) {
        setComfyMessage('Removing background...');
        generatedImage = await removeBackground({ generatedImage, layer, meshDbId, cameraAngleJson });
      }

      if (generatedImage) {
        // Project the full generated image — the layer's mask.png (below)
        // constrains visibility to the painted region, not the UV map alpha.
        // Project using the captured camera angle — the live camera may have
        // moved since the composite/mask were captured.
        const projected = await viewerRef.current?.projectImageToUvMap(generatedImage, cameraAngle, textureResolution);
        const uvMapDataUrl = projected?.uvMap;
        if (uvMapDataUrl) {
          await layerApi.saveUvMap(id, layer.id, meshDbId, uvMapDataUrl);
        }

        // The inpaint mask render target is already UV-space (white =
        // painted), so it saves directly as the layer's mask.png — the layer
        // shader samples mask.r where white = visible.
        const inpaintMaskDataUrl = viewerRef.current?.inpaintMaskToDataURL?.();
        if (inpaintMaskDataUrl) {
          await layerApi.saveMasks(id, meshDbId, [{ layerId: layer.id, base64Mask: inpaintMaskDataUrl }]);
        }

        const updatedLayers = await loadMeshLayers(meshDbId);
        await refreshLayerTextures(updatedLayers);

        // Bump thumb versions so the layer row's <img> tags refetch — they
        // fired on mount (before the files were saved), got 404s, and hid
        // themselves until the src changes.
        setLayerThumbVersion((v) => v + 1);
        setMaskThumbVersions((prev) => ({ ...prev, [layer.id]: (prev[layer.id] || 0) + 1 }));
      }
      setLayerAssetsGenerating(layer.id, false);
      newLayerId = null;

      setComfyProgress(100);
      setComfyMessage('Done');
      // Hide the inpaint overlay so the new layer's changes are visible
      setInpaintMaskVisible(false);
    } catch (err) {
      console.error('Inpaint failed:', err);
      setComfyMessage(`Error: ${err.message}`);
    } finally {
      if (newLayerId) setLayerAssetsGenerating(newLayerId, false);
      setGenerating(false);
    }
  };

  return (
    <div className="fixed bottom-0 left-0 z-20 w-80 max-w-[calc(100vw-20rem)] bg-white/95 dark:bg-gray-800/95 backdrop-blur border-t border-r border-gray-200 dark:border-gray-700 rounded-tr-lg shadow-lg max-h-[calc(100vh-5em)] flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setInpaintMaskVisible((v) => !v)}
            className={`flex-shrink-0 translate-y-[4px] pr-2 transition ${
              inpaintMaskVisible
                ? 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                : 'text-gray-300 dark:text-gray-600 hover:text-gray-500'
            }`}
            aria-label={inpaintMaskVisible ? 'Hide inpaint mask' : 'Show inpaint mask'}
            title={inpaintMaskVisible ? 'Hide inpaint mask' : 'Show inpaint mask'}
          >
            <Icon name={inpaintMaskVisible ? 'visibility' : 'visibility_off'} className="text-2xl" />
          </button>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Inpaint Tool</h3>
        </div>
        <div className="flex items-center">
          <button
            onClick={() => viewerRef.current?.clearInpaintMask?.()}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 mr-1"
            aria-label="Clear inpaint mask"
            title="Clear inpaint mask"
          >
            <Icon name="deselect" className="text-xl" />
          </button>
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
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Prompt</label>
          <TextArea
            value={inpaintPrompt}
            onChange={(e) => setInpaintPrompt(e.target.value)}
            placeholder="Describe what to inpaint..."
            rows={4}
          />
        </div>

        <ReferenceImagesSection maxRefs={1} />

        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Inpaint Image Model</label>
          <Select
            value={inpaintModelId}
            onChange={handleInpaintModelChange}
            options={inpaintModelOptions}
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={useDepthStep}
            onChange={(e) => {
              setUseDepthStep(e.target.checked);
              localStorage.setItem('inpaintUseDepthStep', e.target.checked ? '1' : '0');
            }}
            className="w-4 h-4 cursor-pointer accent-purple-500"
          />
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Use Depth To Image Step</span>
        </label>
      </div>

      <div className="p-3 border-t border-gray-200 dark:border-gray-700">
        {generating && (
          <div className="mb-2">
            <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
              <span>{comfyMessage || 'Inpainting...'}</span>
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
          onClick={handleInpaint}
          disabled={generating || !selectedMesh || !inpaintModelId}
          className="w-full px-4 py-2 border-2 border-green-600 text-green-600 dark:text-green-400 dark:border-green-500 rounded-lg hover:bg-green-600 hover:text-white dark:hover:bg-green-600 dark:hover:text-white transition font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating ? 'Inpainting...' : 'Inpaint To New Layer'}
        </button>
      </div>
    </div>
  );
}
