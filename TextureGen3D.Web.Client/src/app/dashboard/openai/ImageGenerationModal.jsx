import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSession } from '@/context/session';
import { OpenAI } from '@/api/admin/openai';
import Input from '@/components/forms/input';
import Select from '@/components/forms/select';
import TextArea from '@/components/forms/textarea';
import Checkbox from '@/components/forms/checkbox';
import ButtonOutline from '@/components/ui/button-outline';
import Message from '@/components/ui/message';

const IG_TYPES = [
    { value: 0, label: 'Cost Per Million Tokens' },
    { value: 1, label: 'Cost Per Megapixel' }
];

const MODEL_TYPES = [
    { value: 0, label: 'Image Generation' },
    { value: 1, label: 'Depth To Image' },
    { value: 2, label: 'Inpainting' },
    { value: 3, label: '6-Angle Image Model' },
    { value: 4, label: 'Background Removal' }
];

// Gradio API-parameter role options, keyed by model Type. The dropdown for
// each Gradio endpoint parameter offers only the roles valid for that type.
const GRADIO_PARAM_OPTIONS = {
    0: ['Reference Image', 'Prompt', 'Seed', 'Resolution'],
    1: ['Depth Map', 'Reference Image', 'Prompt', 'Seed', 'Resolution'],
    2: ['Reference Image', 'Mask Image', 'Prompt', 'Seed', 'Resolution'],
    3: ['Front Image', 'Left Image', 'Right Image', 'Back Image', 'Top Image', 'Bottom Image', 'Prompt', 'Seed', 'Resolution'],
    4: ['Reference Image']
};
const RESOLUTIONS = [
    { value: '1024x1024', label: '1024 x 1024' },
    { value: '2048x2048', label: '2048 x 2048' },
    { value: '3680x3680', label: '3680 x 3680' }
];

const TOKEN_COST = 0.01;

function parseResolution(res) {
    const [w, h] = res.split('x').map(Number);
    return { w, h };
}

function estimateTokens(form, calc) {
    const type = parseInt(form.pricingType) || 0;

    if (type === 0) {
        const cpmit = parseFloat(form.cpmitTokens) || 0;
        const cpmii = parseFloat(form.cpmiiTokens) || 0;
        const cpmo = parseFloat(form.cpmoTokens) || 0;

        const prompt = calc.prompt || '';
        const inputCount = parseInt(calc.inputImageCount) || 0;
        const inRes = parseResolution(calc.inputResolution);
        const outRes = parseResolution(calc.outputResolution);

        const textTokens = Math.ceil(prompt.length / 4);
        const inTilesW = Math.ceil(inRes.w / 512);
        const inTilesH = Math.ceil(inRes.h / 512);
        const imageInputTokens = inputCount * 48 * inTilesW * inTilesH;
        const outTilesW = Math.ceil(outRes.w / 512);
        const outTilesH = Math.ceil(outRes.h / 512);
        const outputTokens = 48 * outTilesW * outTilesH;

        const textCost = (textTokens / 1_000_000) * cpmit;
        const imageInputCost = (imageInputTokens / 1_000_000) * cpmii;
        const outputCost = (outputTokens / 1_000_000) * cpmo;
        const totalCost = textCost + imageInputCost + outputCost;
        const tokens = Math.max(1, Math.round(totalCost / TOKEN_COST));

        return {
            textTokens, imageInputTokens, outputTokens,
            textCost, imageInputCost, outputCost, totalCost, tokens
        };
    } else {
        const outRes = parseResolution(calc.outputResolution);
        const megapixels = (outRes.w * outRes.h) / (1024 * 1024);

        let costPerMP = 0;
        if (megapixels <= 1) costPerMP = parseFloat(form.cp1k) || 0;
        else if (megapixels <= 4) costPerMP = parseFloat(form.cp2k) || 0;
        else if (megapixels <= 16) costPerMP = parseFloat(form.cp4k) || 0;
        else costPerMP = parseFloat(form.cp8k) || 0;

        const outputCount = parseInt(calc.outputImageCount) || 1;
        const totalCost = megapixels * costPerMP * outputCount;
        const tokens = Math.max(1, Math.round(totalCost / TOKEN_COST));

        return { megapixels, costPerMP, outputCount, totalCost, tokens };
    }
}

export default function ImageGenerationModal({ model, onClose, onSave }) {
    const [form, setForm] = useState({
        modelKey: '',
        name: '',
        model: '',
        cpmitTokens: '',
        cpmiiTokens: '',
        cpmoTokens: '',
        type: 0,
        pricingType: 0,
        cp1k: '',
        cp2k: '',
        cp4k: '',
        cp8k: '',
        workflowJson: '',
        promptPath: '',
        depthMapPath: '',
        inputImagesPath: '',
        seedPath: '',
        prompt: '',
        endpointUrl: '',
        active: true
    });
    const [calc, setCalc] = useState({
        prompt: '',
        inputResolution: '1024x1024',
        inputImageCount: '0',
        outputResolution: '1024x1024',
        outputImageCount: '1'
    });
    const [error, setError] = useState(null);
    const [message, setMessage] = useState(null);
    const workflowTextareaRef = useRef(null);

    // Gradio state
    const session = useSession();
    const { getGradioEndpoints } = useMemo(() => OpenAI(session), [session]);
    const [gradioEndpoints, setGradioEndpoints] = useState([]);
    const [selectedGradioEndpoint, setSelectedGradioEndpoint] = useState(null);
    const [gradioLoading, setGradioLoading] = useState(false);
    const [gradioError, setGradioError] = useState(null);
    const [gradioParamMappings, setGradioParamMappings] = useState({}); // paramName -> 'Depth Map' | 'Reference Image'

    const isComfyUI = form.model.toLowerCase() === 'comfyui';
    const isGradio = form.model.toLowerCase() === 'gradio';

    useEffect(() => {
        if (model) {
            setForm({
                modelKey: model.modelKey || '',
                name: model.name || '',
                model: model.model || '',
                cpmitTokens: model.cpmitTokens?.toString() || '0',
                cpmiiTokens: model.cpmiiTokens?.toString() || '0',
                cpmoTokens: model.cpmoTokens?.toString() || '0',
                type: model.type ?? 0,
                pricingType: model.pricingType ?? 0,
                cp1k: model.cp1k?.toString() || '0',
                cp2k: model.cp2k?.toString() || '0',
                cp4k: model.cp4k?.toString() || '0',
                cp8k: model.cp8k?.toString() || '0',
                workflowJson: model.workflowJson || '',
                promptPath: model.promptPath || '',
                depthMapPath: model.depthMapPath || '',
                inputImagesPath: model.inputImagesPath || '',
                seedPath: model.seedPath || '',
                prompt: model.prompt || '',
                endpointUrl: model.endpointUrl || '',
                paramMappings: model.paramMappings || '',
                active: model.active !== false
            });
        } else {
            setForm({
                modelKey: '',
                name: '',
                model: '',
                cpmitTokens: '0',
                cpmiiTokens: '0',
                cpmoTokens: '0',
                type: 0,
                pricingType: 0,
                cp1k: '0',
                cp2k: '0',
                cp4k: '0',
                cp8k: '0',
                workflowJson: '',
                promptPath: '',
                depthMapPath: '',
                inputImagesPath: '',
                seedPath: '',
                prompt: '',
                endpointUrl: '',
                paramMappings: '',
                active: true
            });
        }
        setError(null);
        setMessage(null);
    }, [model]);

    // Initialize Gradio endpoint + parameter mappings from saved DB values when form loads
    useEffect(() => {
        const isGradioModel = form.model?.toLowerCase() === 'gradio';
        if (isGradioModel && form.endpointUrl) {
            const fullPath = form.endpointUrl;
            const displayPath = fullPath.replace('/gradio_api/call/', '');
            // Reconstruct parameter list and mappings from saved DB columns
            const params = [];
            const mappings = {};
            if (form.depthMapPath) {
                params.push(form.depthMapPath);
                mappings[form.depthMapPath] = 'Depth Map';
            }
            if (form.inputImagesPath) {
                params.push(form.inputImagesPath);
                mappings[form.inputImagesPath] = 'Reference Image';
            }
            if (form.promptPath) {
                params.push(form.promptPath);
                mappings[form.promptPath] = 'Prompt';
            }
            if (form.seedPath) {
                params.push(form.seedPath);
                mappings[form.seedPath] = 'Seed';
            }
            // The full param→role map saved in ParamMappings JSON covers roles
            // the 4 legacy columns can't (Mask Image, the six angle images) —
            // merge it on top of the column-derived reconstruction.
            if (form.paramMappings) {
                try {
                    const saved = JSON.parse(form.paramMappings);
                    for (const [paramName, role] of Object.entries(saved)) {
                        mappings[paramName] = role;
                        if (!params.includes(paramName)) params.push(paramName);
                    }
                } catch {
                    /* malformed JSON — fall back to the column reconstruction */
                }
            }
            setSelectedGradioEndpoint({ fullPath, path: displayPath, parameters: params });
            setGradioParamMappings(mappings);
        } else if (!isGradioModel) {
            // Reset Gradio state when switching to a non-Gradio model
            setSelectedGradioEndpoint(null);
            setGradioParamMappings({});
            setGradioEndpoints([]);
        }
    }, [form.endpointUrl, form.model, form.depthMapPath, form.inputImagesPath, form.promptPath, form.seedPath, form.paramMappings]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleChange = (field, value) => {
        setForm(prev => ({ ...prev, [field]: value }));
    };

    const handleCalcChange = (field, value) => {
        setCalc(prev => ({ ...prev, [field]: value }));
    };

    const handleFetchGradioEndpoints = async () => {
        setGradioLoading(true);
        setGradioError(null);
        try {
            const res = await getGradioEndpoints();
            if (res.data?.success) {
                setGradioEndpoints(res.data.data || []);
                setSelectedGradioEndpoint(null);
                setGradioParamMappings({});
            } else {
                setGradioError(res.data?.message || 'Failed to fetch Gradio endpoints');
            }
        } catch (err) {
            setGradioError(err.message || 'Failed to fetch Gradio endpoints');
        } finally {
            setGradioLoading(false);
        }
    };

    const handleGradioEndpointClick = (endpoint) => {
        setSelectedGradioEndpoint(endpoint);
        // Initialize param mappings with empty values
        const mappings = {};
        for (const param of endpoint.parameters) {
            mappings[param] = '';
        }
        setGradioParamMappings(mappings);
    };

    const handleGradioCancelEndpoint = () => {
        setSelectedGradioEndpoint(null);
        setGradioParamMappings({});
    };

    const handleGradioParamChange = (paramName, value) => {
        setGradioParamMappings(prev => ({ ...prev, [paramName]: value }));
    };

    const handleSave = () => {
        if (!form.modelKey) {
            setError('Model Key is required');
            return;
        }
        if (!form.name || !form.model) {
            setError('Name and Model are required');
            return;
        }

        setError(null);

        // For Gradio models, resolve the parameter mappings to DepthMapPath / InputImagesPath / PromptPath / SeedPath
        let depthMapPath = form.depthMapPath;
        let inputImagesPath = form.inputImagesPath;
        let promptPath = form.promptPath;
        let seedPath = form.seedPath;
        if (isGradio) {
            for (const [paramName, mapping] of Object.entries(gradioParamMappings)) {
                if (mapping === 'Depth Map') depthMapPath = paramName;
                else if (mapping === 'Reference Image') inputImagesPath = paramName;
                else if (mapping === 'Prompt') promptPath = paramName;
                else if (mapping === 'Seed') seedPath = paramName;
            }
        }

        // Persist the complete param→role map — roles beyond the 4 legacy
        // columns (Mask Image, Front/Left/Right/Back/Top/Bottom Image) only
        // exist in this JSON.
        const paramMappingsJson = isGradio
            ? JSON.stringify(
                Object.fromEntries(
                    Object.entries(gradioParamMappings).filter(([, role]) => role)
                )
              )
            : null;

        const payload = {
            id: model?.id || 0,
            modelKey: form.modelKey,
            name: form.name,
            model: form.model,
            cpmitTokens: parseFloat(form.cpmitTokens) || 0,
            cpmiiTokens: parseFloat(form.cpmiiTokens) || 0,
            cpmoTokens: parseFloat(form.cpmoTokens) || 0,
            type: parseInt(form.type) || 0,
            cp1k: parseFloat(form.cp1k) || 0,
            cp2k: parseFloat(form.cp2k) || 0,
            cp4k: parseFloat(form.cp4k) || 0,
            cp8k: parseFloat(form.cp8k) || 0,
            workflowJson: isComfyUI ? form.workflowJson : null,
            promptPath: isComfyUI || isGradio ? promptPath : null,
            depthMapPath: isComfyUI || isGradio ? depthMapPath : null,
            inputImagesPath: isComfyUI || isGradio ? inputImagesPath : null,
            seedPath: isComfyUI || isGradio ? seedPath : null,
            prompt: isComfyUI ? form.prompt : null,
            endpointUrl: isGradio ? (selectedGradioEndpoint?.fullPath || form.endpointUrl || null) : null,
            paramMappings: paramMappingsJson,
            pricingType: parseInt(form.pricingType) || 0,
            active: form.active
        };

        if (onSave) {
            onSave(payload);
        }
        if (onClose) {
            onClose();
        }
    };

    const isCPM = parseInt(form.pricingType) === 0;
    const result = useMemo(() => estimateTokens(form, calc), [form, calc]);

    let formula;
    if (isCPM) {
        formula = (
            <div className="text-sm font-mono space-y-1 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div>Text Input: {result.textTokens} tokens / 1,000,000 x ${parseFloat(form.cpmitTokens) || 0} = ${result.textCost.toFixed(6)}</div>
                <div>Image Input: {result.imageInputTokens} tokens / 1,000,000 x ${parseFloat(form.cpmiiTokens) || 0} = ${result.imageInputCost.toFixed(6)}</div>
                <div>Output: {result.outputTokens} tokens / 1,000,000 x ${parseFloat(form.cpmoTokens) || 0} = ${result.outputCost.toFixed(6)}</div>
                <div className="border-t border-gray-300 dark:border-gray-700 pt-1">
                    Total Cost = ${result.textCost.toFixed(6)} + ${result.imageInputCost.toFixed(6)} + ${result.outputCost.toFixed(6)} = ${result.totalCost.toFixed(6)}
                </div>
                <div>Total Cost / ${TOKEN_COST} = <strong>{result.tokens} Tokens</strong></div>
            </div>
        );
    } else {
        formula = (
            <div className="text-sm font-mono space-y-1 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div>Output Resolution: {calc.outputResolution} = {result.megapixels.toFixed(2)} MP</div>
                <div>Cost Per MP: ${result.costPerMP}</div>
                <div>Total Image Outputs: {result.outputCount}</div>
                <div className="border-t border-gray-300 dark:border-gray-700 pt-1">
                    {result.megapixels.toFixed(2)} MP x ${result.costPerMP} x {result.outputCount} = ${result.totalCost.toFixed(6)}
                </div>
                <div>Total Cost / ${TOKEN_COST} = <strong>{result.tokens} Tokens</strong></div>
            </div>
        );
    }

    return (
        <div className="w-full max-w-[1000px] rounded-lg bg-white dark:bg-gray-800 shadow-xl">
            {error && (
                <div className="mb-4 p-3 rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">{error}</div>
            )}
            {message && (
                <Message type={message.type} onClose={() => setMessage(null)}>
                    {message.text}
                </Message>
            )}
            <div className="flex gap-6">
                <div className="flex-1 space-y-4">
                    <div className="flex gap-4">
                        <div className="flex-1">
                            <Input
                                label="Model Key"
                                name="modelKey"
                                value={form.modelKey}
                                onInput={(e) => handleChange('modelKey', e.target.value)}
                            />
                        </div>
                        <div className="flex-1">
                            <Input
                                label="Name"
                                name="name"
                                value={form.name}
                                onInput={(e) => handleChange('name', e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="flex gap-4">
                        <div className="flex-1">
                            <Select
                                label="Model Type"
                                name="modelType"
                                options={MODEL_TYPES}
                                value={form.type}
                                onChange={(e) => {
                                    const newType = parseInt(e.target.value);
                                    handleChange('type', newType);
                                    // Clear param mappings whose role isn't valid for the new type
                                    const allowed = new Set(GRADIO_PARAM_OPTIONS[newType] || []);
                                    setGradioParamMappings((prev) => {
                                        const next = {};
                                        for (const [paramName, role] of Object.entries(prev)) {
                                            next[paramName] = allowed.has(role) ? role : '';
                                        }
                                        return next;
                                    });
                                }}
                            />
                        </div>
                    </div>
                    <div className="flex gap-4">
                        <div className="flex-1">
                            <Input
                                label="Model"
                                name="model"
                                value={form.model}
                                onInput={(e) => handleChange('model', e.target.value)}
                            />
                        </div>
                        <div className="flex-1">
                            <Select
                                label="Pricing Type"
                                name="pricingType"
                                options={IG_TYPES}
                                value={form.pricingType}
                                onChange={(e) => handleChange('pricingType', parseInt(e.target.value))}
                            />
                        </div>
                    </div>
                    {isCPM && (
                        <div className="flex gap-4">
                            <div className="flex-1">
                                <Input
                                    label="CPM Text Input"
                                    title="Cost per million text input tokens. The dollar amount charged for every 1,000,000 text tokens sent as the prompt."
                                    name="cpmitTokens"
                                    type="number"
                                    value={form.cpmitTokens}
                                    onInput={(e) => handleChange('cpmitTokens', e.target.value)}
                                />
                            </div>
                            <div className="flex-1">
                                <Input
                                    label="CPM Image Input"
                                    title="Cost per million image input tokens. The dollar amount charged for every 1,000,000 tokens used to process input reference images."
                                    name="cpmiiTokens"
                                    type="number"
                                    value={form.cpmiiTokens}
                                    onInput={(e) => handleChange('cpmiiTokens', e.target.value)}
                                />
                            </div>
                            <div className="flex-1">
                                <Input
                                    label="CPM Output"
                                    title="Cost per million output tokens. The dollar amount charged for every 1,000,000 tokens generated in the output image."
                                    name="cpmoTokens"
                                    type="number"
                                    value={form.cpmoTokens}
                                    onInput={(e) => handleChange('cpmoTokens', e.target.value)}
                                />
                            </div>
                        </div>
                    )}
                    {!isCPM && (
                        <div className="flex gap-4">
                            <div className="flex-1">
                                <Input
                                    label="CP1K"
                                    title="Cost per megapixel for images up to 1024 x 1024 resolution."
                                    name="cp1k"
                                    type="number"
                                    value={form.cp1k}
                                    onInput={(e) => handleChange('cp1k', e.target.value)}
                                />
                            </div>
                            <div className="flex-1">
                                <Input
                                    label="CP2K"
                                    title="Cost per megapixel for images up to 2048 x 2048 resolution."
                                    name="cp2k"
                                    type="number"
                                    value={form.cp2k}
                                    onInput={(e) => handleChange('cp2k', e.target.value)}
                                />
                            </div>
                            <div className="flex-1">
                                <Input
                                    label="CP4K"
                                    title="Cost per megapixel for images up to 4096 x 4096 resolution."
                                    name="cp4k"
                                    type="number"
                                    value={form.cp4k}
                                    onInput={(e) => handleChange('cp4k', e.target.value)}
                                />
                            </div>
                            <div className="flex-1">
                                <Input
                                    label="CP8K"
                                    title="Cost per megapixel for images up to 8192 x 8192 resolution."
                                    name="cp8k"
                                    type="number"
                                    value={form.cp8k}
                                    onInput={(e) => handleChange('cp8k', e.target.value)}
                                />
                            </div>
                        </div>
                    )}
                    <Checkbox
                        name="active"
                        label="Active"
                        checked={form.active}
                        onChange={(e) => handleChange('active', e.target.checked)}
                    />
                    {isGradio && (
                        <div className="space-y-3">
                            <ButtonOutline
                                color="blue"
                                onClick={handleFetchGradioEndpoints}
                                disabled={gradioLoading}
                            >
                                {gradioLoading ? 'Loading...' : 'Get Gradio API Endpoints'}
                            </ButtonOutline>
                            {gradioError && (
                                <div className="p-2 rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 text-sm">
                                    {gradioError}
                                </div>
                            )}
                            {(gradioEndpoints.length > 0 || selectedGradioEndpoint) && (
                                <div className="space-y-2">
                                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Gradio API Endpoints</h4>
                                    <div className="space-y-1">
                                        {/* Show fetched endpoints, or just the selected one if not fetched yet */}
                                        {(gradioEndpoints.length > 0
                                            ? gradioEndpoints.filter((ep) => !selectedGradioEndpoint || selectedGradioEndpoint.fullPath === ep.fullPath)
                                            : [selectedGradioEndpoint]
                                        ).map((ep) => {
                                            const isSelected = selectedGradioEndpoint?.fullPath === ep.fullPath;
                                            return (
                                                <div
                                                    key={ep.fullPath}
                                                    onClick={() => !isSelected && handleGradioEndpointClick(ep)}
                                                    className={`flex items-center justify-between px-3 py-2 rounded-lg border transition text-sm ${
                                                        isSelected
                                                            ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                                                            : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 cursor-pointer'
                                                    }`}
                                                >
                                                    <span>{ep.path}</span>
                                                    {isSelected && (
                                                        <ButtonOutline
                                                            color="gray"
                                                            size="small"
                                                            onClick={(e) => { e.stopPropagation(); handleGradioCancelEndpoint(); }}
                                                        >
                                                            Cancel
                                                        </ButtonOutline>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            {selectedGradioEndpoint && (
                                <div className="space-y-2">
                                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">API Parameters</h4>
                                    <div className="space-y-2">
                                        {selectedGradioEndpoint.parameters.map((param) => (
                                            <div key={param} className="flex items-center gap-3">
                                                <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{param}</span>
                                                <div className="w-48">
                                                    <Select
                                                        name={`gradio-param-${param}`}
                                                        options={[
                                                            { value: '', label: '-- Select --' },
                                                            ...(GRADIO_PARAM_OPTIONS[form.type] || GRADIO_PARAM_OPTIONS[0]).map((role) => ({
                                                                value: role,
                                                                label: role
                                                            }))
                                                        ]}
                                                        value={gradioParamMappings[param] || ''}
                                                        onChange={(e) => handleGradioParamChange(param, e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    {isComfyUI && (
                        <div className="space-y-2">
                            <div className="mb-4">
                                <label htmlFor="workflowJson" className="block text-sm font-medium mb-1">
                                    Workflow JSON
                                </label>
                                <textarea
                                    id="workflowJson"
                                    name="workflowJson"
                                    ref={workflowTextareaRef}
                                    rows={10}
                                    value={form.workflowJson}
                                    onInput={(e) => handleChange('workflowJson', e.target.value)}
                                    className="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y border-gray-300 dark:border-gray-600 font-mono text-sm"
                                />
                            </div>
                            <Input
                                label="Prompt JSON Path"
                                name="promptPath"
                                value={form.promptPath}
                                onInput={(e) => handleChange('promptPath', e.target.value)}
                            />
                            <Input
                                label="Depth Map JSON Path"
                                name="depthMapPath"
                                value={form.depthMapPath}
                                onInput={(e) => handleChange('depthMapPath', e.target.value)}
                            />
                            <Input
                                label="Image Inputs JSON Path"
                                name="inputImagesPath"
                                value={form.inputImagesPath}
                                onInput={(e) => handleChange('inputImagesPath', e.target.value)}
                            />
                            <Input
                                label="Seed JSON Path"
                                name="seedPath"
                                value={form.seedPath}
                                onInput={(e) => handleChange('seedPath', e.target.value)}
                            />
                            <div className="mb-4">
                                <label htmlFor="prompt" className="block text-sm font-medium mb-1">
                                    Prompt
                                </label>
                                <textarea
                                    id="prompt"
                                    name="prompt"
                                    rows={6}
                                    value={form.prompt}
                                    onInput={(e) => handleChange('prompt', e.target.value)}
                                    className="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y border-gray-300 dark:border-gray-600 font-mono text-sm"
                                />
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex-1 flex flex-col justify-end">
                    <div className="mb-4">
                        <h3 className="text-lg font-semibold mb-3">Token Calculator</h3>
                        {isCPM && (
                            <>
                                <TextArea
                                    label="Prompt"
                                    name="calcPrompt"
                                    rows={3}
                                    value={calc.prompt}
                                    onInput={(e) => handleCalcChange('prompt', e.target.value)}
                                />
                                <div className="flex gap-4">
                                    <div className="flex-1">
                                        <Select
                                            label="Input Image"
                                            name="calcInputRes"
                                            options={RESOLUTIONS}
                                            value={calc.inputResolution}
                                            onChange={(e) => handleCalcChange('inputResolution', e.target.value)}
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <Input
                                            label="Total Input Images"
                                            name="calcInputCount"
                                            type="number"
                                            value={calc.inputImageCount}
                                            onInput={(e) => handleCalcChange('inputImageCount', e.target.value)}
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <Select
                                            label="Output Image"
                                            name="calcOutputRes"
                                            options={RESOLUTIONS}
                                            value={calc.outputResolution}
                                            onChange={(e) => handleCalcChange('outputResolution', e.target.value)}
                                        />
                                    </div>
                                </div>
                            </>
                        )}
                        {!isCPM && (
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <Select
                                        label="Output Image Resolution"
                                        name="calcOutputRes"
                                        options={RESOLUTIONS}
                                        value={calc.outputResolution}
                                        onChange={(e) => handleCalcChange('outputResolution', e.target.value)}
                                    />
                                </div>
                                <div className="flex-1">
                                    <Input
                                        label="Total Image Outputs"
                                        name="calcOutputCount"
                                        type="number"
                                        value={calc.outputImageCount}
                                        onInput={(e) => handleCalcChange('outputImageCount', e.target.value)}
                                    />
                                </div>
                            </div>
                        )}
                        {formula}
                    </div>
                </div>
            </div>

            <div className="buttons flex justify-end gap-2">
                <ButtonOutline onClick={onClose} className="cancel">
                    Cancel
                </ButtonOutline>
                <ButtonOutline onClick={handleSave}>
                    Save Changes
                </ButtonOutline>
            </div>
        </div>
    );
}
