import React from 'react';
import { useProject } from '@/context/project';

export default function ErrorOverlay() {
  const { error } = useProject();

  if (!error) return null;

  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-30 max-w-md p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg shadow-lg">
      {error}
    </div>
  );
}
