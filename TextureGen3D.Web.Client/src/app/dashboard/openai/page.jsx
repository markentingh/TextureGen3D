import React, { useEffect, useState, useCallback } from 'react';
import { useSession } from '@/context/session';
import { OpenAI } from '@/api/admin/openai';
import Tabs from '@/components/ui/tabs';
import Modal from '@/components/ui/modal';
import Spinner from '@/components/ui/spinner';
import Icon from '@/components/ui/icon';
import Button from '@/components/ui/button';
import ButtonOutline from '@/components/ui/button-outline';
import Input from '@/components/forms/input';
import Checkbox from '@/components/forms/checkbox';
import Message from '@/components/ui/message';

const formatDate = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  return date.toLocaleString();
};

const formatDateShort = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  return date.toLocaleDateString();
};

const truncate = (text, length = 50) => {
  if (!text) return '';
  return text.length > length ? text.substring(0, length) + '...' : text;
};

const formatCost = (value) => {
  if (value === null || value === undefined) return '$0.00';
  return `$${Number(value).toFixed(4)}`;
};

const emptyLlmModel = () => ({
  name: '',
  model: '',
  endpoint: '',
  privateKey: '',
  type: 0,
  enabled: false,
  preferred: false,
});

const emptyImageModel = () => ({
  modelKey: '',
  name: '',
  model: '',
  cpmitTokens: 0,
  cpmiitTokens: 0,
  cpmotTokens: 0,
  type: 0,
  cp1k: 0,
  cp2k: 0,
  cp4k: 0,
  cp8k: 0,
  active: false,
});

export default function DashboardOpenAI() {
  const { token } = useSession();
  const api = OpenAI({ token });

  // LLM Endpoints state
  const [llmModels, setLlmModels] = useState([]);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmMessage, setLlmMessage] = useState(null);
  const [llmModalOpen, setLlmModalOpen] = useState(false);
  const [llmEditing, setLlmEditing] = useState(null);
  const [llmForm, setLlmForm] = useState(emptyLlmModel());
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmDeleteId, setLlmDeleteId] = useState(null);
  const [llmDeleting, setLlmDeleting] = useState(false);

  // Image Endpoints state
  const [imageModels, setImageModels] = useState([]);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageMessage, setImageMessage] = useState(null);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [imageEditing, setImageEditing] = useState(null);
  const [imageForm, setImageForm] = useState(emptyImageModel());
  const [imageSaving, setImageSaving] = useState(false);
  const [imageDeleteId, setImageDeleteId] = useState(null);
  const [imageDeleting, setImageDeleting] = useState(false);

  // Image Generations state
  const [generations, setGenerations] = useState([]);
  const [generationsTotal, setGenerationsTotal] = useState(0);
  const [generationsStart, setGenerationsStart] = useState(0);
  const [generationsLength] = useState(25);
  const [generationsLoading, setGenerationsLoading] = useState(false);
  const [generationsMessage, setGenerationsMessage] = useState(null);
  const [dailyCosts, setDailyCosts] = useState([]);
  const [dailyCostsLoading, setDailyCostsLoading] = useState(false);
  const [costRange, setCostRange] = useState('30days');

  // ---------- LLM Endpoints ----------
  const fetchLlmModels = useCallback(() => {
    setLlmLoading(true);
    api.getAll()
      .then((res) => {
        setLlmLoading(false);
        if (res.data.success) {
          setLlmModels(res.data.data || []);
        } else {
          setLlmMessage({ type: 'error', text: res.data.message || 'Failed to fetch LLM models' });
        }
      })
      .catch((error) => {
        setLlmLoading(false);
        setLlmMessage({ type: 'error', text: error?.response?.data?.message || 'Failed to fetch LLM models' });
      });
  }, [api]);

  const handleOpenAddLlm = () => {
    setLlmEditing(null);
    setLlmForm(emptyLlmModel());
    setLlmMessage(null);
    setLlmModalOpen(true);
  };

  const handleOpenEditLlm = (model) => {
    setLlmEditing(model);
    setLlmForm({
      name: model.name || '',
      model: model.model || '',
      endpoint: model.endpoint || '',
      privateKey: '',
      type: model.type ?? 0,
      enabled: model.enabled ?? false,
      preferred: model.preferred ?? false,
    });
    setLlmMessage(null);
    setLlmModalOpen(true);
  };

  const handleSaveLlm = () => {
    if (!llmForm.name || !llmForm.model) {
      setLlmMessage({ type: 'error', text: 'Name and Model are required' });
      return;
    }
    setLlmSaving(true);
    const payload = { ...llmForm };
    if (llmEditing) {
      payload.id = llmEditing.id;
    }
    const request = llmEditing ? api.update(payload) : api.add(payload);
    request
      .then((res) => {
        setLlmSaving(false);
        if (res.data.success) {
          setLlmModalOpen(false);
          fetchLlmModels();
        } else {
          setLlmMessage({ type: 'error', text: res.data.message || 'Failed to save model' });
        }
      })
      .catch((error) => {
        setLlmSaving(false);
        setLlmMessage({ type: 'error', text: error?.response?.data?.message || 'Failed to save model' });
      });
  };

  const handleToggleLlmEnabled = (model) => {
    api.setEnabled(model.id, !model.enabled)
      .then((res) => {
        if (res.data.success) {
          fetchLlmModels();
        } else {
          setLlmMessage({ type: 'error', text: res.data.message || 'Failed to toggle enabled' });
        }
      })
      .catch((error) => {
        setLlmMessage({ type: 'error', text: error?.response?.data?.message || 'Failed to toggle enabled' });
      });
  };

  const handleSetPreferred = (model) => {
    api.setPreferred(model.id)
      .then((res) => {
        if (res.data.success) {
          fetchLlmModels();
        } else {
          setLlmMessage({ type: 'error', text: res.data.message || 'Failed to set preferred' });
        }
      })
      .catch((error) => {
        setLlmMessage({ type: 'error', text: error?.response?.data?.message || 'Failed to set preferred' });
      });
  };

  const handleConfirmDeleteLlm = () => {
    if (!llmDeleteId) return;
    setLlmDeleting(true);
    api.delete(llmDeleteId)
      .then((res) => {
        setLlmDeleting(false);
        if (res.data.success) {
          setLlmDeleteId(null);
          fetchLlmModels();
        } else {
          setLlmMessage({ type: 'error', text: res.data.message || 'Failed to delete model' });
        }
      })
      .catch((error) => {
        setLlmDeleting(false);
        setLlmMessage({ type: 'error', text: error?.response?.data?.message || 'Failed to delete model' });
      });
  };

  // ---------- Image Endpoints ----------
  const fetchImageModels = useCallback(() => {
    setImageLoading(true);
    api.getImageModels()
      .then((res) => {
        setImageLoading(false);
        if (res.data.success) {
          setImageModels(res.data.data || []);
        } else {
          setImageMessage({ type: 'error', text: res.data.message || 'Failed to fetch image models' });
        }
      })
      .catch((error) => {
        setImageLoading(false);
        setImageMessage({ type: 'error', text: error?.response?.data?.message || 'Failed to fetch image models' });
      });
  }, [api]);

  const handleOpenAddImage = () => {
    setImageEditing(null);
    setImageForm(emptyImageModel());
    setImageMessage(null);
    setImageModalOpen(true);
  };

  const handleOpenEditImage = (model) => {
    setImageEditing(model);
    setImageForm({
      modelKey: model.modelKey || '',
      name: model.name || '',
      model: model.model || '',
      cpmitTokens: model.cpmitTokens ?? 0,
      cpmiitTokens: model.cpmiitTokens ?? 0,
      cpmotTokens: model.cpmotTokens ?? 0,
      type: model.type ?? 0,
      cp1k: model.cp1k ?? 0,
      cp2k: model.cp2k ?? 0,
      cp4k: model.cp4k ?? 0,
      cp8k: model.cp8k ?? 0,
      active: model.active ?? false,
    });
    setImageMessage(null);
    setImageModalOpen(true);
  };

  const handleSaveImage = () => {
    if (!imageForm.modelKey || !imageForm.model) {
      setImageMessage({ type: 'error', text: 'ModelKey and Model are required' });
      return;
    }
    setImageSaving(true);
    const payload = { ...imageForm };
    if (imageEditing) {
      payload.id = imageEditing.id;
    }
    api.saveImageModel(payload)
      .then((res) => {
        setImageSaving(false);
        if (res.data.success) {
          setImageModalOpen(false);
          fetchImageModels();
        } else {
          setImageMessage({ type: 'error', text: res.data.message || 'Failed to save image model' });
        }
      })
      .catch((error) => {
        setImageSaving(false);
        setImageMessage({ type: 'error', text: error?.response?.data?.message || 'Failed to save image model' });
      });
  };

  const handleToggleImageActive = (model) => {
    api.toggleImageModelActive(model.id, !model.active)
      .then((res) => {
        if (res.data.success) {
          fetchImageModels();
        } else {
          setImageMessage({ type: 'error', text: res.data.message || 'Failed to toggle active' });
        }
      })
      .catch((error) => {
        setImageMessage({ type: 'error', text: error?.response?.data?.message || 'Failed to toggle active' });
      });
  };

  const handleConfirmDeleteImage = () => {
    if (!imageDeleteId) return;
    setImageDeleting(true);
    api.deleteImageModel(imageDeleteId)
      .then((res) => {
        setImageDeleting(false);
        if (res.data.success) {
          setImageDeleteId(null);
          fetchImageModels();
        } else {
          setImageMessage({ type: 'error', text: res.data.message || 'Failed to delete image model' });
        }
      })
      .catch((error) => {
        setImageDeleting(false);
        setImageMessage({ type: 'error', text: error?.response?.data?.message || 'Failed to delete image model' });
      });
  };

  // ---------- Image Generations ----------
  const fetchGenerations = useCallback(() => {
    setGenerationsLoading(true);
    api.getImageGenerations(generationsStart, generationsLength)
      .then((res) => {
        setGenerationsLoading(false);
        if (res.data.success) {
          const data = res.data.data || {};
          setGenerations(data.items || data.generations || data || []);
          setGenerationsTotal(data.totalCount || data.total || 0);
        } else {
          setGenerationsMessage({ type: 'error', text: res.data.message || 'Failed to fetch generations' });
        }
      })
      .catch((error) => {
        setGenerationsLoading(false);
        setGenerationsMessage({ type: 'error', text: error?.response?.data?.message || 'Failed to fetch generations' });
      });
  }, [api, generationsStart, generationsLength]);

  const fetchDailyCosts = useCallback(() => {
    setDailyCostsLoading(true);
    api.getDailyCosts(costRange)
      .then((res) => {
        setDailyCostsLoading(false);
        if (res.data.success) {
          setDailyCosts(res.data.data || []);
        } else {
          setGenerationsMessage({ type: 'error', text: res.data.message || 'Failed to fetch daily costs' });
        }
      })
      .catch((error) => {
        setDailyCostsLoading(false);
        setGenerationsMessage({ type: 'error', text: error?.response?.data?.message || 'Failed to fetch daily costs' });
      });
  }, [api, costRange]);

  useEffect(() => {
    fetchLlmModels();
  }, [fetchLlmModels]);

  useEffect(() => {
    fetchImageModels();
  }, [fetchImageModels]);

  useEffect(() => {
    fetchGenerations();
  }, [fetchGenerations]);

  useEffect(() => {
    fetchDailyCosts();
  }, [fetchDailyCosts]);

  // ---------- Render: LLM Endpoints Tab ----------
  const renderLlmTab = () => (
    <div>
      {llmMessage && (
        <Message type={llmMessage.type} onClose={() => setLlmMessage(null)}>
          {llmMessage.text}
        </Message>
      )}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">LLM Endpoints</h2>
        <Button onClick={handleOpenAddLlm}>
          <Icon name="add" className="mr-1" />
          Add Model
        </Button>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded shadow overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-gray-100 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Model</th>
              <th className="px-4 py-3">Endpoint</th>
              <th className="px-4 py-3">Enabled</th>
              <th className="px-4 py-3">Preferred</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {llmModels.map((model) => (
              <tr key={model.id} className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-4 py-3 font-medium">{model.name}</td>
                <td className="px-4 py-3">{model.model}</td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{model.endpoint}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${model.enabled ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                    {model.enabled ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {model.preferred ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-200">
                      Preferred
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 flex-wrap">
                    <Button size="small" color="gray" onClick={() => handleOpenEditLlm(model)}>
                      <Icon name="edit" className="mr-1" />
                      Edit
                    </Button>
                    <Button size="small" color={model.enabled ? 'gray' : 'green'} onClick={() => handleToggleLlmEnabled(model)}>
                      <Icon name={model.enabled ? 'block' : 'check'} className="mr-1" />
                      {model.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    {!model.preferred && (
                      <ButtonOutline size="small" onClick={() => handleSetPreferred(model)}>
                        <Icon name="star" className="mr-1" />
                        Set Preferred
                      </ButtonOutline>
                    )}
                    <Button size="small" color="red" onClick={() => setLlmDeleteId(model.id)}>
                      <Icon name="delete" className="mr-1" />
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {llmModels.length === 0 && !llmLoading && (
              <tr>
                <td colSpan="6" className="px-4 py-6 text-center text-gray-500">
                  No LLM models found.
                </td>
              </tr>
            )}
            {llmLoading && (
              <tr>
                <td colSpan="6" className="px-4 py-6 text-center text-gray-500">
                  <Spinner className="text-2xl" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {llmModalOpen && (
        <Modal title={llmEditing ? 'Edit LLM Model' : 'Add LLM Model'} onClose={() => setLlmModalOpen(false)}>
          {llmMessage && (
            <Message type={llmMessage.type} onClose={() => setLlmMessage(null)}>
              {llmMessage.text}
            </Message>
          )}
          <Input
            name="name"
            label="Name"
            value={llmForm.name}
            onChange={(e) => setLlmForm((prev) => ({ ...prev, name: e.target.value }))}
            required
          />
          <Input
            name="model"
            label="Model"
            value={llmForm.model}
            onChange={(e) => setLlmForm((prev) => ({ ...prev, model: e.target.value }))}
            required
          />
          <Input
            name="endpoint"
            label="Endpoint"
            value={llmForm.endpoint}
            onChange={(e) => setLlmForm((prev) => ({ ...prev, endpoint: e.target.value }))}
            placeholder="https://api.openai.com/v1"
          />
          <Input
            name="privateKey"
            label="Private Key"
            type="password"
            value={llmForm.privateKey}
            onChange={(e) => setLlmForm((prev) => ({ ...prev, privateKey: e.target.value }))}
            placeholder={llmEditing ? 'Leave blank to keep existing' : 'sk-...'}
          />
          <Input
            name="type"
            label="Type"
            type="number"
            value={llmForm.type}
            onChange={(e) => setLlmForm((prev) => ({ ...prev, type: parseInt(e.target.value, 10) || 0 }))}
          />
          <Checkbox
            name="enabled"
            label="Enabled"
            checked={llmForm.enabled}
            onChange={(e) => setLlmForm((prev) => ({ ...prev, enabled: e.target.checked }))}
          />
          <Checkbox
            name="preferred"
            label="Preferred"
            checked={llmForm.preferred}
            onChange={(e) => setLlmForm((prev) => ({ ...prev, preferred: e.target.checked }))}
          />
          <div className="flex flex-wrap gap-2 mt-2">
            <Button onClick={handleSaveLlm} disabled={llmSaving}>
              {llmSaving ? <Spinner className="mr-1" /> : <Icon name="save" className="mr-1" />}
              {llmEditing ? 'Update' : 'Add'} Model
            </Button>
            <Button color="gray" onClick={() => setLlmModalOpen(false)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}

      {llmDeleteId && (
        <Modal title="Delete LLM Model" onClose={() => setLlmDeleteId(null)}>
          <p className="mb-4">Are you sure you want to delete this LLM model? This action cannot be undone.</p>
          <div className="flex gap-2">
            <Button color="red" onClick={handleConfirmDeleteLlm} disabled={llmDeleting}>
              {llmDeleting ? <Spinner className="mr-1" /> : <Icon name="delete" className="mr-1" />}
              Delete
            </Button>
            <Button color="gray" onClick={() => setLlmDeleteId(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );

  // ---------- Render: Image Endpoints Tab ----------
  const renderImageTab = () => (
    <div>
      {imageMessage && (
        <Message type={imageMessage.type} onClose={() => setImageMessage(null)}>
          {imageMessage.text}
        </Message>
      )}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Image Endpoints</h2>
        <Button onClick={handleOpenAddImage}>
          <Icon name="add" className="mr-1" />
          Add Model
        </Button>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded shadow overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-gray-100 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Model Key</th>
              <th className="px-4 py-3">Model</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {imageModels.map((model) => (
              <tr key={model.id} className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-4 py-3 font-medium">{model.name}</td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{model.modelKey}</td>
                <td className="px-4 py-3">{model.model}</td>
                <td className="px-4 py-3">{model.type}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${model.active ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                    {model.active ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 flex-wrap">
                    <Button size="small" color="gray" onClick={() => handleOpenEditImage(model)}>
                      <Icon name="edit" className="mr-1" />
                      Edit
                    </Button>
                    <Button size="small" color={model.active ? 'gray' : 'green'} onClick={() => handleToggleImageActive(model)}>
                      <Icon name={model.active ? 'block' : 'check'} className="mr-1" />
                      {model.active ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button size="small" color="red" onClick={() => setImageDeleteId(model.id)}>
                      <Icon name="delete" className="mr-1" />
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {imageModels.length === 0 && !imageLoading && (
              <tr>
                <td colSpan="6" className="px-4 py-6 text-center text-gray-500">
                  No image models found.
                </td>
              </tr>
            )}
            {imageLoading && (
              <tr>
                <td colSpan="6" className="px-4 py-6 text-center text-gray-500">
                  <Spinner className="text-2xl" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {imageModalOpen && (
        <Modal title={imageEditing ? 'Edit Image Model' : 'Add Image Model'} onClose={() => setImageModalOpen(false)} className="max-w-2xl">
          {imageMessage && (
            <Message type={imageMessage.type} onClose={() => setImageMessage(null)}>
              {imageMessage.text}
            </Message>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <Input
              name="modelKey"
              label="Model Key"
              value={imageForm.modelKey}
              onChange={(e) => setImageForm((prev) => ({ ...prev, modelKey: e.target.value }))}
              required
            />
            <Input
              name="name"
              label="Name"
              value={imageForm.name}
              onChange={(e) => setImageForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <Input
              name="model"
              label="Model"
              value={imageForm.model}
              onChange={(e) => setImageForm((prev) => ({ ...prev, model: e.target.value }))}
              required
            />
            <Input
              name="type"
              label="Type"
              type="number"
              value={imageForm.type}
              onChange={(e) => setImageForm((prev) => ({ ...prev, type: parseInt(e.target.value, 10) || 0 }))}
            />
            <Input
              name="cpmitTokens"
              label="CPMIT Tokens"
              type="number"
              value={imageForm.cpmitTokens}
              onChange={(e) => setImageForm((prev) => ({ ...prev, cpmitTokens: parseFloat(e.target.value) || 0 }))}
            />
            <Input
              name="cpmiitTokens"
              label="CPMIIT Tokens"
              type="number"
              value={imageForm.cpmiitTokens}
              onChange={(e) => setImageForm((prev) => ({ ...prev, cpmiitTokens: parseFloat(e.target.value) || 0 }))}
            />
            <Input
              name="cpmotTokens"
              label="CPMOT Tokens"
              type="number"
              value={imageForm.cpmotTokens}
              onChange={(e) => setImageForm((prev) => ({ ...prev, cpmotTokens: parseFloat(e.target.value) || 0 }))}
            />
            <Input
              name="cp1k"
              label="CP 1K"
              type="number"
              value={imageForm.cp1k}
              onChange={(e) => setImageForm((prev) => ({ ...prev, cp1k: parseFloat(e.target.value) || 0 }))}
            />
            <Input
              name="cp2k"
              label="CP 2K"
              type="number"
              value={imageForm.cp2k}
              onChange={(e) => setImageForm((prev) => ({ ...prev, cp2k: parseFloat(e.target.value) || 0 }))}
            />
            <Input
              name="cp4k"
              label="CP 4K"
              type="number"
              value={imageForm.cp4k}
              onChange={(e) => setImageForm((prev) => ({ ...prev, cp4k: parseFloat(e.target.value) || 0 }))}
            />
            <Input
              name="cp8k"
              label="CP 8K"
              type="number"
              value={imageForm.cp8k}
              onChange={(e) => setImageForm((prev) => ({ ...prev, cp8k: parseFloat(e.target.value) || 0 }))}
            />
          </div>
          <Checkbox
            name="active"
            label="Active"
            checked={imageForm.active}
            onChange={(e) => setImageForm((prev) => ({ ...prev, active: e.target.checked }))}
          />
          <div className="flex flex-wrap gap-2 mt-2">
            <Button onClick={handleSaveImage} disabled={imageSaving}>
              {imageSaving ? <Spinner className="mr-1" /> : <Icon name="save" className="mr-1" />}
              {imageEditing ? 'Update' : 'Add'} Model
            </Button>
            <Button color="gray" onClick={() => setImageModalOpen(false)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}

      {imageDeleteId && (
        <Modal title="Delete Image Model" onClose={() => setImageDeleteId(null)}>
          <p className="mb-4">Are you sure you want to delete this image model? This action cannot be undone.</p>
          <div className="flex gap-2">
            <Button color="red" onClick={handleConfirmDeleteImage} disabled={imageDeleting}>
              {imageDeleting ? <Spinner className="mr-1" /> : <Icon name="delete" className="mr-1" />}
              Delete
            </Button>
            <Button color="gray" onClick={() => setImageDeleteId(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );

  // ---------- Render: Image Generations Tab ----------
  const renderGenerationsTab = () => {
    const currentPage = Math.floor(generationsStart / generationsLength) + 1;
    const totalPages = Math.ceil(generationsTotal / generationsLength);

    return (
      <div>
        {generationsMessage && (
          <Message type={generationsMessage.type} onClose={() => setGenerationsMessage(null)}>
            {generationsMessage.text}
          </Message>
        )}
        <h2 className="text-xl font-bold mb-4">Image Generations</h2>

        {/* Daily Costs Summary */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">Daily Costs</h3>
            <select
              value={costRange}
              onChange={(e) => setCostRange(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
            >
              <option value="7days">Last 7 days</option>
              <option value="30days">Last 30 days</option>
              <option value="90days">Last 90 days</option>
            </select>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded shadow overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-100 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Total Cost</th>
                  <th className="px-4 py-3">Total Tokens</th>
                  <th className="px-4 py-3">Total Generations</th>
                </tr>
              </thead>
              <tbody>
                {dailyCosts.map((item, index) => (
                  <tr key={index} className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3">{formatDateShort(item.date)}</td>
                    <td className="px-4 py-3 font-medium">{formatCost(item.totalCost ?? item.cost)}</td>
                    <td className="px-4 py-3">{item.totalTokens ?? item.tokens ?? 0}</td>
                    <td className="px-4 py-3">{item.totalGenerations ?? item.generations ?? item.count ?? 0}</td>
                  </tr>
                ))}
                {dailyCosts.length === 0 && !dailyCostsLoading && (
                  <tr>
                    <td colSpan="4" className="px-4 py-6 text-center text-gray-500">
                      No daily cost data available.
                    </td>
                  </tr>
                )}
                {dailyCostsLoading && (
                  <tr>
                    <td colSpan="4" className="px-4 py-6 text-center text-gray-500">
                      <Spinner className="text-2xl" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Generations Table */}
        <div className="bg-white dark:bg-gray-800 rounded shadow overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-100 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3">Prompt</th>
                <th className="px-4 py-3">Tokens</th>
                <th className="px-4 py-3">Cost</th>
              </tr>
            </thead>
            <tbody>
              {generations.map((gen, index) => (
                <tr key={gen.id ?? index} className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-3 text-sm">{formatDate(gen.date ?? gen.created ?? gen.createdAt)}</td>
                  <td className="px-4 py-3 text-sm">{gen.user ?? gen.userName ?? gen.email ?? 'N/A'}</td>
                  <td className="px-4 py-3 text-sm">{gen.project ?? gen.projectName ?? 'N/A'}</td>
                  <td className="px-4 py-3 text-sm">{gen.model ?? gen.modelName ?? 'N/A'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 max-w-xs" title={gen.prompt}>
                    {truncate(gen.prompt)}
                  </td>
                  <td className="px-4 py-3 text-sm">{gen.tokens ?? gen.totalTokens ?? 0}</td>
                  <td className="px-4 py-3 text-sm font-medium">{formatCost(gen.cost ?? gen.totalCost)}</td>
                </tr>
              ))}
              {generations.length === 0 && !generationsLoading && (
                <tr>
                  <td colSpan="7" className="px-4 py-6 text-center text-gray-500">
                    No image generations found.
                  </td>
                </tr>
              )}
              {generationsLoading && (
                <tr>
                  <td colSpan="7" className="px-4 py-6 text-center text-gray-500">
                    <Spinner className="text-2xl" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between gap-4 mt-4">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {generationsTotal > 0
              ? `Showing ${generationsStart + 1} to ${Math.min(generationsStart + generationsLength, generationsTotal)} of ${generationsTotal} entries`
              : 'No entries'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentPage <= 1 || generationsLoading}
              onClick={() => setGenerationsStart(Math.max(0, generationsStart - generationsLength))}
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Page {currentPage}{totalPages > 0 ? ` of ${totalPages}` : ''}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages || generationsLoading}
              onClick={() => setGenerationsStart(generationsStart + generationsLength)}
              className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    );
  };

  const tabs = [
    { id: 'llm', label: 'LLM Endpoints', content: renderLlmTab() },
    { id: 'image', label: 'Image Endpoints', content: renderImageTab() },
    { id: 'generations', label: 'Image Generations', content: renderGenerationsTab() },
  ];

  return (
    <div>
      <h1 className="text-3xl font-bold mb-4">OpenAI Administration</h1>
      <Tabs tabs={tabs} defaultTab="llm" />
    </div>
  );
}
