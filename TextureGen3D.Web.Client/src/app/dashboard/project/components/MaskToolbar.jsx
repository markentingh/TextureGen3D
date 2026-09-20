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
  } = useProject();

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
      {(maskTool === 'brush' || maskTool === 'eraser' || maskTool === 'inpaint') && (
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
