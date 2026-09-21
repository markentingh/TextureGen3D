import React, { useState, useEffect } from 'react';
import { ProjectProvider, useProject } from '@/context/project';
import { useModal } from '@/context/modal';
import LoadingScreen from './components/LoadingScreen';
import ViewportSection from './components/ViewportSection';
import MouseHints from './components/MouseHints';
import MaskToolbar from './components/MaskToolbar';
import ProjectHeader from './components/ProjectHeader';
import RightSidebar from './components/RightSidebar';
import GenerateImagesPanel from './components/GenerateImagesPanel';
import InpaintPanel from './components/InpaintPanel';
import ErrorOverlay from './components/ErrorOverlay';

function ProjectContent() {
  const { id, token, loading, loadedRef, loadProject, project, viewerRef, thumbGenAttemptedRef, maskTool, textureResolution } = useProject();
  const { showModal, hideModal } = useModal();
  const [showPanel, setShowPanel] = useState(true);

  // One-time project load
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-generate project thumbnail from the first mesh if none exists
  useEffect(() => {
    if (thumbGenAttemptedRef.current) return;
    if (!project || project.hasThumb) return;
    if (!viewerRef.current) return;

    thumbGenAttemptedRef.current = true;

    const timer = setTimeout(async () => {
      try {
        const thumb = viewerRef.current?.captureThumbnail(350);
        if (!thumb) return;
        const { Projects } = await import('@/api/user/projects');
        const api = Projects({ token });
        await api.saveThumb(id, thumb);
      } catch (err) {
        console.error('Failed to auto-generate project thumbnail:', err);
      }
    }, 800);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  // Dev-tools debug helpers — capture the inpaint pipeline's input images
  // (same hidden-canvas captures as Inpaint To Layer) and preview them:
  //   getInpaintMeshImage() — unlit mesh + all layers, no inpaint overlay
  //   getInpaintMaskImage() — the inpaint mask only, on a black background
  useEffect(() => {
    const showPreview = (title, dataUrl) => {
      if (!dataUrl) {
        console.warn(`[${title}] no image captured — is a mesh loaded?`);
        return;
      }
      showModal({
        title,
        className: 'max-w-[90vw] max-h-[90vh]',
        onClose: hideModal,
        body: (
          <div className="flex items-center justify-center" onClick={hideModal}>
            <img
              src={dataUrl}
              alt={title}
              className="max-w-[85vw] max-h-[80vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ),
      });
    };
    window.getInpaintMeshImage = () => {
      const dataUrl = viewerRef.current?.captureCompositeImage?.(textureResolution);
      showPreview('Inpaint Mesh Image', dataUrl);
      return dataUrl;
    };
    window.getInpaintMaskImage = () => {
      const dataUrl = viewerRef.current?.captureInpaintMaskImage?.(textureResolution);
      showPreview('Inpaint Mask Image', dataUrl);
      return dataUrl;
    };
    return () => {
      delete window.getInpaintMeshImage;
      delete window.getInpaintMaskImage;
    };
  }, [viewerRef, textureResolution, showModal, hideModal]);

  // The canvas mounts once and stays mounted — LoadingScreen overlays it
  // instead of replacing it, so the WebGL context is never torn down.
  return (
    <div className="fixed inset-0 overflow-hidden bg-gray-900 text-gray-100">
      <ViewportSection />
      <MaskToolbar />
      <MouseHints />
      <ProjectHeader showPanel={showPanel} setShowPanel={setShowPanel} />
      <RightSidebar />
      {maskTool === 'inpaint' ? (
        <InpaintPanel showPanel={showPanel} setShowPanel={setShowPanel} />
      ) : (
        <GenerateImagesPanel showPanel={showPanel} setShowPanel={setShowPanel} />
      )}
      <ErrorOverlay />
      {loading && (
        <div className="fixed inset-0 z-50 bg-gray-900">
          <LoadingScreen />
        </div>
      )}
    </div>
  );
}

export default function ProjectDetailsPage() {
  return (
    <ProjectProvider>
      <ProjectContent />
    </ProjectProvider>
  );
}
