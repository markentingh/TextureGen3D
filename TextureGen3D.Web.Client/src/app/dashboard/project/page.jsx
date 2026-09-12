import React, { useState, useEffect } from 'react';
import { ProjectProvider, useProject } from '@/context/project';
import LoadingScreen from './components/LoadingScreen';
import ViewportSection from './components/ViewportSection';
import MouseHints from './components/MouseHints';
import ProjectHeader from './components/ProjectHeader';
import RightSidebar from './components/RightSidebar';
import GenerateImagesPanel from './components/GenerateImagesPanel';
import ErrorOverlay from './components/ErrorOverlay';

function ProjectContent() {
  const { id, token, loading, loadedRef, loadProject, project, viewerRef, thumbGenAttemptedRef } = useProject();
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

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-gray-900 text-gray-100">
      <ViewportSection />
      <MouseHints />
      <ProjectHeader showPanel={showPanel} setShowPanel={setShowPanel} />
      <RightSidebar />
      <GenerateImagesPanel showPanel={showPanel} setShowPanel={setShowPanel} />
      <ErrorOverlay />
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
