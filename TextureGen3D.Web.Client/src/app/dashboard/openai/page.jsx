import React, { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/context/modal';
import Icon from '@/components/ui/icon';
import ButtonOutline from '@/components/ui/button-outline';
import Button from '@/components/ui/button';
import ButtonIcon from '@/components/ui/button-icon';
import Input from '@/components/forms/input';
import Select from '@/components/forms/select';
import TextArea from '@/components/forms/textarea';
import Checkbox from '@/components/forms/checkbox';
import Message from '@/components/ui/message';
import Tabs from '@/components/ui/tabs';
import Checked from '@/components/ui/checked';
import ImageGenerationModal from './ImageGenerationModal';
import ImageGenerationsTab from './ImageGenerationsTab';
import { useSession } from '@/context/session';
import { OpenAI } from '@/api/admin/openai';

const LLM_TYPES = [
    { value: 0, label: 'Local' },
    { value: 1, label: 'Cloud' }
];

function LlmModelForm({ editingModel, initialForm, onSave, onCancel }) {
    const [form, setForm] = useState(initialForm);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const handleFormChange = (field, value) => {
        setForm(prev => ({ ...prev, [field]: value }));
    };

    const handleSave = async () => {
        if (!form.name || !form.model || !form.endpoint) {
            setError('Name, Model, and Endpoint are required');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await onSave(form, editingModel);
        } catch (err) {
            setError(err.message || 'Failed to save model');
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            {error && <div className="mb-4 p-3 rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">{error}</div>}
            <Input
                label="Name"
                name="name"
                value={form.name}
                onInput={(e) => handleFormChange('name', e.target.value)}
            />
            <Input
                label="Model"
                name="model"
                value={form.model}
                onInput={(e) => handleFormChange('model', e.target.value)}
            />
            <Input
                label="Endpoint"
                name="endpoint"
                value={form.endpoint}
                onInput={(e) => handleFormChange('endpoint', e.target.value)}
            />
            <Input
                label="Private Key"
                name="privateKey"
                type="password"
                value={form.privateKey}
                onInput={(e) => handleFormChange('privateKey', e.target.value)}
            />
            <Select
                label="Type"
                name="type"
                options={LLM_TYPES}
                value={form.type}
                onChange={(e) => handleFormChange('type', parseInt(e.target.value))}
            />
            <TextArea
                label="Extra Body (JSON)"
                name="extraBody"
                value={form.extraBody}
                rows={3}
                onInput={(e) => handleFormChange('extraBody', e.target.value)}
            />
            <Checkbox
                name="enabled"
                label="Enabled"
                checked={form.enabled}
                onChange={(e) => handleFormChange('enabled', e.target.checked)}
            />
            <Checkbox
                name="preferred"
                label="Preferred"
                checked={form.preferred}
                onChange={(e) => handleFormChange('preferred', e.target.checked)}
            />
            <div className="buttons flex gap-3">
                <Button onClick={handleSave} disabled={saving}>Save</Button>
                <Button color="gray" className="cancel" onClick={onCancel}>Cancel</Button>
            </div>
        </>
    );
}

export default function AdminOpenAI() {
    const session = useSession();
    const { getAll, add, update, setEnabled, setPreferred, delete: deleteModel, getImageModels, saveImageModel, toggleImageModelActive, deleteImageModel } = OpenAI(session);

    const getEmptyForm = () => ({
        modelId: 0,
        name: '',
        model: '',
        endpoint: '',
        privateKey: '',
        type: 1,
        enabled: false,
        preferred: false,
        extraBody: ''
    });

    const { showModal, hideModal } = useModal();

    const [models, setModels] = useState([]);
    const [message, setMessage] = useState(null);

    const [imageModels, setImageModels] = useState([]);
    const [editingImageModel, setEditingImageModel] = useState(null);
    const [imageError, setImageError] = useState(null);

    useEffect(() => {
        fetchModels();
        fetchImageModels();
    }, []);

    const fetchModels = () => {
        getAll().then(response => {
            if (response.data.success) {
                setModels(response.data.data || []);
            }
        }).catch(error => {
            console.error('Error fetching LLM models:', error);
            setMessage({ type: 'error', text: 'Failed to fetch LLM models' });
        });
    };

    const handleAdd = () => {
        showModal({
            title: 'Add LLM Model',
            onClose: hideModal,
            body: <LlmModelForm initialForm={getEmptyForm()} onSave={handleModelSave} onCancel={hideModal} />,
        });
    };

    const handleEdit = (model) => {
        const initialForm = {
            modelId: model.modelId,
            name: model.name || '',
            model: model.model || '',
            endpoint: model.endpoint || '',
            privateKey: model.privateKey || '',
            type: model.type ?? 1,
            enabled: !!model.enabled,
            preferred: !!model.preferred,
            extraBody: model.extraBody || ''
        };
        showModal({
            title: 'Edit LLM Model',
            onClose: hideModal,
            body: <LlmModelForm editingModel={model} initialForm={initialForm} onSave={handleModelSave} onCancel={hideModal} />,
        });
    };

    const handleModelSave = async (form, editingModel) => {
        const payload = { ...form };
        const action = editingModel ? update : add;
        const response = await action(payload);
        if (response.data.success) {
            fetchModels();
            hideModal();
        } else {
            throw new Error(response.data.message || 'Failed to save model');
        }
    };

    const handleToggleEnabled = (model) => {
        const newEnabled = !model.enabled;
        setEnabled(model.modelId, newEnabled).then(response => {
            if (response.data.success) {
                fetchModels();
            } else {
                console.error('Failed to update enabled state:', response.data.message);
            }
        }).catch(error => {
            console.error('Error updating enabled state:', error);
        });
    };

    const handleTogglePreferred = (model) => {
        if (model.preferred) return;
        setPreferred(model.modelId).then(response => {
            if (response.data.success) {
                fetchModels();
            } else {
                console.error('Failed to update preferred state:', response.data.message);
            }
        }).catch(error => {
            console.error('Error updating preferred state:', error);
        });
    };

    const handleDelete = (model) => {
        if (!confirm(`Are you sure you want to delete the model "${model.name}"?`)) return;
        deleteModel(model.modelId).then(response => {
            if (response.data.success) {
                fetchModels();
            }
        }).catch(error => {
            console.error('Error deleting model:', error);
        });
    };

    const fetchImageModels = () => {
        getImageModels().then(response => {
            if (response.data.success) {
                setImageModels(response.data.data || []);
            }
        }).catch(error => {
            console.error('Error fetching image generation models:', error);
            setMessage({ type: 'error', text: 'Failed to fetch image generation models' });
        });
    };

    const handleImageModelClick = (model) => {
        setEditingImageModel(model);
        setImageError(null);
        showModal({
            title: 'Edit Image Model',
            className: 'max-w-[1000px] w-full',
            onClose: hideModal,
            body: <ImageGenerationModal
                model={model}
                onClose={hideModal}
                onSave={handleImageModelSave}
            />,
        });
    };

    const handleAddImageModel = () => {
        setEditingImageModel(null);
        setImageError(null);
        showModal({
            title: 'Add Image Model',
            className: 'max-w-[1000px] w-full',
            onClose: hideModal,
            body: <ImageGenerationModal
                model={null}
                onClose={hideModal}
                onSave={handleImageModelSave}
            />,
        });
    };

    const handleImageModelSave = (payload) => {
        saveImageModel(payload).then(response => {
            if (response.data.success) {
                fetchImageModels();
                hideModal();
            } else {
                setImageError(response.data.message || 'Failed to save image model');
            }
        }).catch(error => {
            console.error('Error saving image model:', error);
            setImageError('Failed to save image model');
        });
    };

    const handleImageModelDelete = (model) => {
        if (!confirm(`Are you sure you want to delete the model "${model.name}"?`)) return;
        deleteImageModel(model.id).then(response => {
            if (response.data.success) {
                fetchImageModels();
            }
        }).catch(error => {
            console.error('Error deleting image model:', error);
        });
    };

    const handleToggleImageModelActive = (model) => {
        toggleImageModelActive(model.id, !model.active).then(response => {
            if (response.data.success) {
                fetchImageModels();
            }
        }).catch(error => {
            console.error('Error toggling image model active:', error);
        });
    };

    const llmEndpointsContent = (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl">OpenAI Endpoints</h1>
                <ButtonOutline onClick={handleAdd}>
                    <Icon name="add" />
                    <span className="ml-2">Add Model</span>
                </ButtonOutline>
            </div>

            {message && (
                <Message type={message.type} onClose={() => setMessage(null)}>
                    {message.text}
                </Message>
            )}

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-100 dark:bg-gray-700">
                        <tr>
                            <th className="px-4 py-3 w-16 text-center"></th>
                            <th className="px-4 py-3">Name</th>
                            <th className="px-4 py-3">Model</th>
                            <th className="px-4 py-3">Endpoint</th>
                            <th className="px-4 py-3">Type</th>
                            <th className="px-4 py-3 w-40"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {models.map(model => (
                            <tr
                                key={model.modelId}
                                onClick={() => handleEdit(model)}
                                className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                            >
                                <td className="px-4 py-3 text-center cursor-default" onClick={(e) => e.stopPropagation()}>
                                    <input
                                        type="checkbox"
                                        checked={model.enabled}
                                        onChange={() => handleToggleEnabled(model)}
                                        title={model.enabled ? 'Disable' : 'Enable'}
                                        className="w-[18px] h-[18px] cursor-pointer"
                                    />
                                </td>
                                <td className="px-4 py-3">{model.name}</td>
                                <td className="px-4 py-3">{model.model}</td>
                                <td className="px-4 py-3 truncate max-w-xs">{model.endpoint}</td>
                                <td className="px-4 py-3">{model.type === 0 ? 'Local' : 'Cloud'}</td>
                                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            className={'icon ' + (model.preferred ? 'text-amber-400' : '')}
                                            onClick={() => handleTogglePreferred(model)}
                                            title={model.preferred ? 'Preferred' : 'Set as preferred'}
                                        >
                                            <Icon name={model.preferred ? 'star_shine' : 'star'} />
                                        </button>
                                        <ButtonIcon name="edit" onClick={() => handleEdit(model)} title="Edit model" />
                                        <ButtonIcon name="delete" color="red" onClick={() => handleDelete(model)} title="Delete model" />
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {models.length === 0 && (
                            <tr>
                                <td colSpan="6" className="text-center py-8 text-gray-600 dark:text-gray-400">
                                    No Open AI endpoints configured. Click "Add Model" to get started.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const imageGenerationContent = (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl">Image Generation</h1>
                <ButtonOutline onClick={handleAddImageModel}>
                    <Icon name="add" />
                    <span className="ml-2">Add Model</span>
                </ButtonOutline>
            </div>

            {message && (
                <Message type={message.type} onClose={() => setMessage(null)}>
                    {message.text}
                </Message>
            )}

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-100 dark:bg-gray-700">
                        <tr>
                            <th className="px-4 py-3 w-12"></th>
                            <th className="px-4 py-3">Name</th>
                            <th className="px-4 py-3">Model</th>
                            <th className="px-4 py-3">Cost</th>
                            <th className="px-4 py-3">CPM Text</th>
                            <th className="px-4 py-3">CPM Image</th>
                            <th className="px-4 py-3">CPM Output</th>
                            <th className="px-4 py-3">CP 1K</th>
                            <th className="px-4 py-3">CP 2K</th>
                            <th className="px-4 py-3">CP 4K</th>
                            <th className="px-4 py-3 w-24"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {imageModels.map(model => (
                            <tr
                                key={model.modelKey}
                                onClick={() => handleImageModelClick(model)}
                                className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                            >
                                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                    <div className="cursor-pointer" onClick={(e) => { e.stopPropagation(); handleToggleImageModelActive(model); }}>
                                        <Checked checked={model.active !== false} />
                                    </div>
                                </td>
                                <td className="px-4 py-3">{model.name || '(not configured)'}</td>
                                <td className="px-4 py-3">{model.model || '-'}</td>
                                <td className="px-4 py-3">{model.type === 1 ? 'Per Megapixel' : 'Per Million'}</td>
                                <td className="px-4 py-3">{model.type === 1 ? '-' : `$${model.cpmitTokens}`}</td>
                                <td className="px-4 py-3">{model.type === 1 ? '-' : `$${model.cpmiiTokens}`}</td>
                                <td className="px-4 py-3">{model.type === 1 ? '-' : `$${model.cpmoTokens}`}</td>
                                <td className="px-4 py-3">{model.type === 1 ? `$${model.cp1k}` : '-'}</td>
                                <td className="px-4 py-3">{model.type === 1 ? `$${model.cp2k}` : '-'}</td>
                                <td className="px-4 py-3">{model.type === 1 ? `$${model.cp4k}` : '-'}</td>
                                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex items-center gap-2">
                                        <ButtonIcon name="edit" onClick={() => handleImageModelClick(model)} title="Edit model" />
                                        {model.id && (
                                            <ButtonIcon name="delete" color="red" onClick={() => handleImageModelDelete(model)} title="Delete model" />
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {imageModels.length === 0 && (
                            <tr>
                                <td colSpan="11" className="text-center py-8 text-gray-600 dark:text-gray-400">
                                    No image generation models configured.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const imageGenerationsContent = useMemo(() => <ImageGenerationsTab />, []);

    const tabs = [
        { id: 'endpoints', label: 'LLM Endpoints', content: llmEndpointsContent },
        { id: 'image-gen', label: 'Image Endpoints', content: imageGenerationContent },
        { id: 'image-generations', label: 'Image Generations', content: imageGenerationsContent },
    ];

    return (
        <div className="admin-openai">
            <Tabs tabs={tabs} defaultTab="endpoints" />
        </div>
    );
}
