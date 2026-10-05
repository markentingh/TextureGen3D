import React from 'react';
import MeshList from './MeshList';
import Layers from './Layers';
import ProjectSettings from './ProjectSettings';

// Composition shell — section logic lives in MeshList (mesh selection,
// aux visibility, mesh delete/download), Layers (layer list, thumbnails,
// drag reorder, layer menus, fill picker, stitch modal) and
// ProjectSettings (texture resolution, viewport, model upload/list).
// Each pulls its own state/handlers from useProject().
export default function RightSidebar() {
  return (
    <aside className="fixed top-0 right-0 z-20 h-screen w-72 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col">
      <div className="flex-1 overflow-y-auto">
        <MeshList />
        <Layers />
      </div>

      {/* Pinned to the bottom of the sidebar */}
      <ProjectSettings />
    </aside>
  );
}
