import React, { useState, useRef, useEffect } from 'react';
import Modal from '@/components/ui/modal';
import Select from '@/components/forms/select';
import Spinner from '@/components/ui/spinner';
import { ProjectReferences } from '@/api/user/projectReferences';

export default function ReferenceModal({ reference, projectId, token, imageModels, mode, onClose, onSaved }) {
  const [selectedModelId, setSelectedModelId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (imageModels.length > 0) {
      setSelectedModelId(imageModels[0].id?.toString() || imageModels[0].modelKey || imageModels[0].name);
    }
  }, [imageModels]);

  const handleGenerate = async () => {
    if (!prompt.trim() || !selectedModelId) return;
    setGenerating(true);
    setError('');
    setGeneratedImage(null);
    try {
      const api = ProjectReferences({ token });
      const res = await api.generate(projectId, {
        referenceId: reference.id,
        imageModelId: parseInt(selectedModelId),
        prompt,
      });
      if (res.data?.success && res.data?.data?.image) {
        setGeneratedImage(`data:image/png;base64,${res.data.data.image}`);
      } else {
        setError(res.data?.message || 'Generation failed');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!generatedImage) return;
    setSaving(true);
    setError('');
    try {
      const base64 = generatedImage.split(',')[1];
      const api = ProjectReferences({ token });
      const res = await api.saveGenerated(projectId, base64, mode === 'edit' ? 'replace' : 'new', mode === 'edit' ? reference.id : null);
      if (res.data?.success) {
        onSaved?.(res.data.data);
        onClose();
      } else {
        setError(res.data?.message || 'Save failed');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const refImageUrl = reference
    ? ProjectReferences({ token }).imageUrl(projectId, reference.id)
    : '';

  return (
    <Modal
      title={mode === 'edit' ? 'Edit Reference' : 'New Reference'}
      onClose={onClose}
      className="max-w-[1200px]"
    >
      <div className="space-y-4">
        {error && (
          <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-4">
          {/* Reference image on the left */}
          <div className="flex-shrink-0">
            <img
              src={refImageUrl}
              alt="Reference"
              className="rounded-lg border border-gray-200 dark:border-gray-600"
              style={{ width: 500, maxHeight: 500, objectFit: 'contain' }}
            />
          </div>

          {/* Generated image placeholder / result on the right */}
          <div className="flex-shrink-0">
            {generatedImage ? (
              <img
                src={generatedImage}
                alt="Generated"
                className="rounded-lg border border-gray-200 dark:border-gray-600"
                style={{ width: 500, maxHeight: 500, objectFit: 'contain' }}
              />
            ) : (
              <div
                className="rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center"
                style={{ width: 500, height: 500 }}
              >
                {generating ? (
                  <div className="flex flex-col items-center gap-2">
                    <Spinner className="text-3xl" />
                    <p className="text-sm text-gray-500">Generating...</p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 dark:text-gray-500 text-center px-4">
                    Generate an image based on the reference
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Image model dropdown */}
        <div>
          <Select
            name="imageModel"
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
            options={imageModels.map((m) => ({
              value: m.id?.toString() || m.modelKey || m.name,
              label: m.name || m.model || m.modelKey,
            }))}
            className="mb-0 w-fit"
          />
        </div>

        {/* Prompt textarea */}
        <div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the image to generate..."
            rows={3}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        {/* Action buttons */}
        <div className="flex justify-end gap-2">
          {!generatedImage ? (
            <button
              onClick={handleGenerate}
              disabled={generating || !prompt.trim() || !selectedModelId}
              className="px-4 py-2 text-sm font-medium rounded-lg border-2 border-green-600 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {generating ? 'Generating...' : 'Generate Image'}
            </button>
          ) : (
            <>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="px-4 py-2 text-sm font-medium rounded-lg border-2 border-green-600 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {generating ? 'Generating...' : 'Regenerate'}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium rounded-lg border-2 border-blue-600 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {saving ? 'Saving...' : mode === 'edit' ? 'Replace Reference' : 'Save New Reference'}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
