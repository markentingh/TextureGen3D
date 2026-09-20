import React from 'react';
import { useProject } from '@/context/project';
import { Projects } from '@/api/user/projects';
import ReferenceImagesSection from './ReferenceImagesSection';
import TextArea from '@/components/forms/textarea';
import Select from '@/components/forms/select';

export default function InpaintPanel({ showPanel, setShowPanel }) {
  const {
    id,
    token,
    models,
    inpaintPrompt,
    setInpaintPrompt,
    imageModels,
    refImageModels,
    selectedModelId,
    setSelectedModelId,
    inpaintModelId,
    setInpaintModelId,
    inpaintModelOptions,
    setProject,
    imageModelOptions,
  } = useProject();

  if (!showPanel || models.length === 0) return null;

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

  const handleInpaintModelChange = (e) => {
    const modelId = e.target.value;
    setInpaintModelId(modelId);
    const selectedModel = refImageModels.find((m) => m.id?.toString() === modelId);
    if (selectedModel?.modelKey) {
      localStorage.setItem('preferredInpaintModel', selectedModel.modelKey);
    }
  };

  return (
    <div className="fixed bottom-0 left-0 z-20 w-80 max-w-[calc(100vw-20rem)] bg-white/95 dark:bg-gray-800/95 backdrop-blur border-t border-r border-gray-200 dark:border-gray-700 rounded-tr-lg shadow-lg max-h-[calc(100vh-5em)] flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Inpaint Tool</h3>
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
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Prompt</label>
          <TextArea
            value={inpaintPrompt}
            onChange={(e) => setInpaintPrompt(e.target.value)}
            placeholder="Describe what to inpaint..."
            rows={4}
          />
        </div>

        <ReferenceImagesSection />

        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Inpaint Image Model</label>
          <Select
            value={inpaintModelId}
            onChange={handleInpaintModelChange}
            options={inpaintModelOptions}
          />
        </div>

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
        <button
          className="w-full px-4 py-2 border-2 border-green-600 text-green-600 dark:text-green-400 dark:border-green-500 rounded-lg hover:bg-green-600 hover:text-white dark:hover:bg-green-600 dark:hover:text-white transition font-medium text-sm"
        >
          Inpaint To New Layer
        </button>
      </div>
    </div>
  );
}
