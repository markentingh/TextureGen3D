import React from 'react';
import { useProject } from '@/context/project';
import Icon from '@/components/ui/icon';
import Slider from '@/components/ui/slider';
import SelectChecklist from '@/components/ui/select-checklist';
import ColorPicker from '@/components/ui/ColorPicker';
import CleanImageReview from './CleanImageReview';

/**
 * MaskToolbar — tool toggle (pointer / mask brush) floating at the right edge
 * of the Generate Images panel, left of the mouse hints. When the brush tool
 * is selected, a floating toolbar with Size / Hardness / Spread sliders
 * appears above the buttons.
 */
export default function MaskToolbar() {
  const {
    maskTool,
    setMaskTool,
    inpaintSign,
    setInpaintSign,
    ctrlHeld,
    altHeld,
    brushSize,
    setBrushSize,
    brushHardness,
    setBrushHardness,
    brushSpread,
    setBrushSpread,
    brushOpacity,
    setBrushOpacity,
    blurStrength,
    setBlurStrength,
    penPressure,
    setPenPressure,
    penPressureTargets,
    setPenPressureTargets,
    brushColor,
    setBrushColor,
    brushPicker,
    setBrushPicker,
    maskMode,
    setMaskMode,
    stampMode,
    setStampMode,
    stampInvertX,
    setStampInvertX,
    stampInvertY,
    setStampInvertY,
    meshLayers,
    selectedLayerIds,
    id,
  } = useProject();

  // The stamp tool can only draw onto plain layers — generated/inpainted
  // layers carry projected model output and are never valid stamp targets.
  const stampDisabled = selectedLayerIds.some((lid) => {
    const l = meshLayers.find((x) => x.id === lid);
    return l && (l.type === 1 || l.type === 2); // Generated / Inpainted
  });

  // If stamp is active when a generated/inpainted layer gets selected,
  // fall back to the pointer tool.
  React.useEffect(() => {
    if (stampDisabled && maskTool === 'stamp') setMaskTool('pointer');
  }, [stampDisabled, maskTool, setMaskTool]);

  const buttonClass = (active) =>
    `w-8 h-8 rounded-full border-2 flex items-center justify-center transition ${
      active
        ? 'border-purple-500 text-purple-400'
        : 'border-transparent text-gray-300 hover:text-white'
    }`;

  // Ctrl temporarily inverts which sign is active (and which button looks selected)
  const effectiveInpaintSign = ctrlHeld ? (inpaintSign === 'add' ? 'subtract' : 'add') : inpaintSign;

  // Alt held while draw is selected acts as copy mode — buttons reflect it
  const effectiveStampMode = altHeld && stampMode === 'draw' ? 'copy' : stampMode;

  // Ctrl temporarily flips the mask tool's brush↔eraser (and which button
  // looks selected) — same convention as the inpaint sign.
  const effectiveMaskMode = ctrlHeld ? (maskMode === 'brush' ? 'eraser' : 'brush') : maskMode;

  // Brush tool color picker — picker edits a local value until OK so Cancel
  // doesn't leave a half-picked color in the brush.
  const [showColorPicker, setShowColorPicker] = React.useState(false);
  const [pickerColor, setPickerColor] = React.useState(brushColor);

  const inpaintToggleClass = (active) =>
    `w-5 h-5 rounded-full border-2 flex items-center justify-center transition ${
      active
        ? 'border-purple-500 text-purple-400'
        : 'border-gray-600 text-gray-500 hover:text-white hover:border-gray-400'
    }`;

  return (
    <div className="flex flex-col items-start gap-2 pl-3 shrink-0 whitespace-nowrap">
      <CleanImageReview />
      {(maskTool === 'brush' || maskTool === 'eraser' || maskTool === 'mask' || maskTool === 'inpaint' || maskTool === 'stamp' || maskTool === 'blur') && (
        <div className="w-[100%] rounded-xl bg-charcoal-700/85 backdrop-blur-sm border-2 border-gray-300/60 shadow-lg px-3 py-2 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
              {maskTool.charAt(0).toUpperCase() + maskTool.slice(1)}
            </div>
            {/* Tool-specific controls sit at the right of the title row —
                same toggles/circle that previously rendered in the button row */}
            {maskTool === 'stamp' && (
              <div className="flex gap-1 items-center">
                <button
                  onClick={() => setStampMode('copy')}
                  className={inpaintToggleClass(effectiveStampMode === 'copy')}
                  aria-label="Copy region"
                  title="Copy region — click the mesh to set the stamp source point (hold Alt while drawing)"
                >
                  <Icon name="screenshot_region" className="!text-[14px] !leading-[14px]" />
                </button>
                <button
                  onClick={() => setStampMode('draw')}
                  className={inpaintToggleClass(effectiveStampMode === 'draw')}
                  aria-label="Draw region"
                  title="Draw region — stamp the copied region onto the selected layer"
                >
                  <Icon name="blur_medium" className="!text-[14px] !leading-[14px]" />
                </button>
              </div>
            )}
            {maskTool === 'inpaint' && (
              <div className="flex gap-1 items-center">
                <button
                  onClick={() => setInpaintSign('add')}
                  className={inpaintToggleClass(effectiveInpaintSign === 'add')}
                  aria-label="Add to inpaint mask"
                  title="Draw the inpaint mask"
                >
                  <Icon name="add" className="!text-[14px] !leading-[14px]" />
                </button>
                <button
                  onClick={() => setInpaintSign('subtract')}
                  className={inpaintToggleClass(effectiveInpaintSign === 'subtract')}
                  aria-label="Remove from inpaint mask"
                  title="Erase Inpaint mask"
                >
                  <Icon name="remove" className="!text-[14px] !leading-[14px]" />
                </button>
              </div>
            )}
            {maskTool === 'mask' && (
              <div className="flex gap-1 items-center">
                <button
                  onClick={() => setMaskMode('brush')}
                  className={inpaintToggleClass(effectiveMaskMode === 'brush')}
                  aria-label="Mask brush"
                  title="Mask brush — paint white onto the mask to reveal the layer (hold Ctrl to erase)"
                >
                  <Icon name="brush" className="!text-[14px] !leading-[14px]" />
                </button>
                <button
                  onClick={() => setMaskMode('eraser')}
                  className={inpaintToggleClass(effectiveMaskMode === 'eraser')}
                  aria-label="Mask eraser"
                  title="Mask eraser — paint black onto the mask to hide the layer (hold Ctrl to paint)"
                >
                  <Icon name="ink_eraser" className="!text-[14px] !leading-[14px]" />
                </button>
              </div>
            )}
            {maskTool === 'brush' && (
              <div className="flex gap-1 items-center">
                <button
                  onClick={() => setBrushPicker(!brushPicker)}
                  className={inpaintToggleClass(brushPicker || altHeld)}
                  aria-label="Pick color from mesh"
                  title="Pick color — hover the mesh to preview the uvmap color under the cursor, click to use it as the brush color (hold Alt for temporary use)"
                >
                  <Icon name="colorize" className="!text-[14px] !leading-[14px]" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPickerColor(brushColor);
                    setShowColorPicker(true);
                  }}
                  className="w-4 h-4 rounded-full border border-white/40 shrink-0"
                  style={{ backgroundColor: brushColor }}
                  aria-label="Brush color"
                  title="Brush color"
                />
              </div>
            )}
          </div>
          <Slider
            label="Size"
            min={1}
            max={300}
            step={1}
            value={brushSize}
            onChange={setBrushSize}
            small
          />
          <Slider
            label="Hardness"
            min={0}
            max={100}
            step={1}
            value={brushHardness}
            onChange={setBrushHardness}
            small
          />
          <Slider
            label="Spread"
            min={0}
            max={100}
            step={1}
            value={brushSpread}
            onChange={setBrushSpread}
            small
          />
          {maskTool === 'blur' ? (
            <Slider
              label="Strength"
              min={1}
              max={100}
              step={1}
              value={blurStrength}
              onChange={setBlurStrength}
              small
            />
          ) : (
            <Slider
              label="Opacity"
              min={1}
              max={100}
              step={1}
              value={brushOpacity}
              onChange={setBrushOpacity}
              small
            />
          )}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-gray-300 shrink-0">
              <input
                type="checkbox"
                checked={penPressure}
                onChange={(e) => setPenPressure(e.target.checked)}
                className="accent-purple-500"
              />
              Pen Pressure
            </label>
            <SelectChecklist
              options={[
                { value: 'size', label: 'Brush Size' },
                { value: 'opacity', label: 'Opacity' },
              ]}
              values={penPressureTargets}
              onChange={setPenPressureTargets}
              placeholder="Select..."
              disabled={!penPressure}
              className="flex-1 min-w-0"
            />
          </div>
          {maskTool === 'stamp' && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={stampInvertX}
                  onChange={(e) => setStampInvertX(e.target.checked)}
                  className="accent-purple-500"
                />
                Invert X
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={stampInvertY}
                  onChange={(e) => setStampInvertY(e.target.checked)}
                  className="accent-purple-500"
                />
                Invert Y
              </label>
            </div>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => setMaskTool('pointer')}
          className={buttonClass(maskTool === 'pointer')}
          aria-label="Pointer tool"
          title="Pointer — left mouse click does nothing"
        >
          <Icon name="arrow_selector_tool" className="text-base" />
        </button>
        <button
          onClick={() => setMaskTool('brush')}
          className={buttonClass(maskTool === 'brush')}
          aria-label="Brush tool"
          title="Brush — paint color onto the selected layer's texture"
        >
          <Icon name="brush" className="text-base" />
        </button>
        <button
          onClick={() => setMaskTool('eraser')}
          className={buttonClass(maskTool === 'eraser')}
          aria-label="Eraser tool"
          title="Eraser — erase texture pixels from the selected layer"
        >
          <Icon name="ink_eraser" className="text-base" />
        </button>
        <button
          onClick={() => setMaskTool('mask')}
          className={buttonClass(maskTool === 'mask')}
          aria-label="Mask tool"
          title="Mask — paint the selected layer's visibility mask (brush reveals, eraser hides)"
        >
          <Icon name="masked_transitions" className="text-base" />
        </button>
        <button
          onClick={() => setMaskTool('blur')}
          className={buttonClass(maskTool === 'blur')}
          aria-label="Blur tool"
          title="Blur — soften the selected layer's texture under the brush"
        >
          <Icon name="blur_on" className="text-base" />
        </button>
        <button
          onClick={() => setMaskTool('inpaint')}
          className={buttonClass(maskTool === 'inpaint')}
          aria-label="Inpainting tool"
          title="Inpainting — mark regions on the mesh to regenerate"
        >
          <Icon name="wand_shine" className="text-base" />
        </button>
        <button
          onClick={() => !stampDisabled && setMaskTool('stamp')}
          disabled={stampDisabled}
          className={`${buttonClass(maskTool === 'stamp')} ${stampDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
          aria-label="Stamp tool"
          title={stampDisabled
            ? 'Stamp — not available on generated or inpainted layers'
            : "Stamp — copy a region of the mesh's combined texture and stamp it onto the selected layer"}
        >
          <Icon name="approval" className="text-base" />
        </button>
      </div>
      {showColorPicker && (
        <ColorPicker
          color={pickerColor}
          onChange={(c) => setPickerColor(c.hex)}
          onOk={(c) => setBrushColor(c.hex)}
          onClose={() => setShowColorPicker(false)}
          projectId={id}
        />
      )}
    </div>
  );
}
