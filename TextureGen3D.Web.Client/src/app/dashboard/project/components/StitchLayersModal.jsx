import React, { useState, useEffect } from 'react';
import Modal from '@/components/ui/modal';
import Select from '@/components/forms/select';
import Spinner from '@/components/ui/spinner';

export default function StitchLayersModal({ layers, projectId, meshDbId, token, imageModels, layerApi, onClose, onStitched }) {
  const [selectedLayerIds, setSelectedLayerIds] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [stitching, setStitching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // All layers selected by default
    setSelectedLayerIds(layers.map((l) => l.id));
  }, [layers]);

  useEffect(() => {
    // Only show Type 0 image models
    const type0Models = imageModels.filter((m) => m.type === 0);
    if (type0Models.length > 0) {
      setSelectedModelId(type0Models[0].id?.toString() || '');
    }
  }, [imageModels]);

  const toggleLayer = (layerId) => {
    setSelectedLayerIds((prev) =>
      prev.includes(layerId) ? prev.filter((id) => id !== layerId) : [...prev, layerId]
    );
  };

  const handleStitch = async () => {
    if (selectedLayerIds.length === 0 || !selectedModelId) return;
    setStitching(true);
    setError('');
    try {
      const res = await layerApi.stitchLayers(projectId, meshDbId, parseInt(selectedModelId), selectedLayerIds);
      if (!res.data?.success) throw new Error(res.data?.message || 'Stitching failed');
      onStitched();
    } catch (err) {
      setError(err.message || 'Stitching failed');
      setStitching(false);
    }
  };

  const type0Models = imageModels.filter((m) => m.type === 0);

  return (
    <Modal
      title="Stitch All Layers Together"
      onClose={onClose}
      className="max-w-2xl"
    >
      <div className="space-y-4">
        {error && (
          <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded text-sm">
            {error}
          </div>
        )}

        {/* Grid of UV map thumbnails with checkboxes */}
        <div>
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
            Select layers to stitch:
          </p>
          <div className="grid grid-cols-5 gap-2 max-h-[400px] overflow-y-auto">
            {layers.map((layer) => {
              const checked = selectedLayerIds.includes(layer.id);
              return (
                <div
                  key={layer.id}
                  className="relative rounded border border-gray-200 dark:border-gray-600 overflow-hidden bg-gray-100 dark:bg-gray-700"
                  style={{ width: 100, height: 100 }}
                >
                  <img
                    src={layerApi.uvmapThumbUrl(projectId, meshDbId, layer.id)}
                    alt={layer.name}
                    className="w-full h-full object-cover"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleLayer(layer.id)}
                    className="absolute top-1 left-1 w-4 h-4 accent-green-500 cursor-pointer z-10"
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs px-1 py-0.5 truncate">
                    {layer.name}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Image model dropdown (Type 0 only) */}
        <div>
          <label className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1 block">
            Image Model
          </label>
          <Select
            name="imageModel"
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
            options={type0Models.map((m) => ({
              value: m.id?.toString() || '',
              label: m.name || m.model || m.modelKey,
            }))}
          />
        </div>

        {/* Stitch button */}
        <button
          onClick={handleStitch}
          disabled={stitching || selectedLayerIds.length === 0 || !selectedModelId}
          className="w-full px-4 py-2 border-2 border-green-600 text-green-600 dark:text-green-500 dark:border-green-500 rounded-lg hover:bg-green-600 hover:text-white dark:hover:bg-green-600 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition font-medium text-sm flex items-center justify-center gap-2"
        >
          {stitching ? (
            <>
              <Spinner className="text-sm" />
              <span>Stitching...</span>
            </>
          ) : (
            'Stitch Selected Layers'
          )}
        </button>
      </div>
    </Modal>
  );
}
