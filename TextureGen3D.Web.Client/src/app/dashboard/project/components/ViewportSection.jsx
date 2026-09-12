import React from 'react';
import ModelViewer from '@/components/viewer/ModelViewer';
import { useProject } from '@/context/project';

export default function ViewportSection() {
  const { selectedMesh, viewerRef, pendingLayersRef, refreshLayerTextures } = useProject();

  return (
    <div className="absolute top-0 left-0 bottom-0 right-72">
      <ModelViewer
        ref={viewerRef}
        selectedMesh={selectedMesh}
        onMeshLoaded={() => {
          if (pendingLayersRef.current) {
            refreshLayerTextures(pendingLayersRef.current);
          }
        }}
      />
    </div>
  );
}
