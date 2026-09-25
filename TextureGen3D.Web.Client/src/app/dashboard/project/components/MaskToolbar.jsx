import React from 'react';
import { useProject } from '@/context/project';
import Icon from '@/components/ui/icon';
import Slider from '@/components/ui/slider';

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
    brushSize,
    setBrushSize,
    brushHardness,
    setBrushHardness,
    brushSpread,
    setBrushSpread,
    brushOpacity,
    setBrushOpacity,
    stampMode,
    setStampMode,
    stampInvertX,
    setStampInvertX,
    stampInvertY,
    setStampInvertY,
    meshLayers,
    selectedLayerIds,
  } = useProject();

  // The stamp tool can only draw onto plain layers — generated/inpainted
  // layers carry projected model output and are never valid stamp targets.
  const stampDisabled = selectedLayerIds.some((lid) => {
    const l = meshLayers.find((x) => x.id === lid);
    return l && (l.inpaint || l.generated);
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

  const inpaintToggleClass = (active) =>
    `w-5 h-5 rounded-full border-2 flex items-center justify-center transition ${
      active
        ? 'border-purple-500 text-purple-400'
        : 'border-gray-600 text-gray-500 hover:text-white hover:border-gray-400'
    }`;

  return (
    <div className="absolute bottom-4 left-80 z-20 flex flex-col items-start gap-2 pl-3">
      {(maskTool === 'brush' || maskTool === 'eraser' || maskTool === 'inpaint' || maskTool === 'stamp') && (
        <div className="w-56 rounded-xl bg-charcoal-700/85 backdrop-blur-sm border-2 border-gray-300/60 shadow-lg px-3 py-2 space-y-2">
          <Slider
            label="Size"
            min={1}
            max={300}
            step={1}
            value={brushSize}
            onChange={setBrushSize}
          />
          <Slider
            label="Hardness"
            min={0}
            max={100}
            step={1}
            value={brushHardness}
            onChange={setBrushHardness}
          />
          <Slider
            label="Spread"
            min={0}
            max={100}
            step={1}
            value={brushSpread}
            onChange={setBrushSpread}
          />
          <Slider
            label="Opacity"
            min={1}
            max={100}
            step={1}
            value={brushOpacity}
            onChange={setBrushOpacity}
          />
          {maskTool === 'stamp' && (
            <>
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
            </>
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
          aria-label="Mask brush tool"
          title="Mask brush — paint white onto the selected layer's mask to reveal parts of it"
        >
          <Icon name="brush" className="text-base" />
        </button>
        <button
          onClick={() => setMaskTool('eraser')}
          className={buttonClass(maskTool === 'eraser')}
          aria-label="Mask eraser tool"
          title="Mask eraser — paint black onto the selected layer's mask to hide parts of it"
        >
          <Icon name="ink_eraser" className="text-base" />
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
        {maskTool === 'stamp' && (
          <div className="flex gap-1 items-center">
            <button
              onClick={() => setStampMode('copy')}
              className={inpaintToggleClass(stampMode === 'copy')}
              aria-label="Copy region"
              title="Copy region — click the mesh to set the stamp source point"
            >
              <Icon name="screenshot_region" className="!text-[14px] !leading-[14px]" />
            </button>
            <button
              onClick={() => setStampMode('draw')}
              className={inpaintToggleClass(stampMode === 'draw')}
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
      </div>
    </div>
  );
}
