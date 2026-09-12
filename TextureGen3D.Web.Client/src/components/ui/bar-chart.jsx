import React, { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

export default function BarChart({ data, formatValue, height = 200, barColor = '#003cbf', barHoverColor = '#0050ff', secondaryColor = '#e91e63', secondaryHoverColor = '#ff4081', primaryLabel = 'Artwork Cost', secondaryLabel = 'Upscale Cost', className = '', showXAxisLabels = true }) {
  const [hovered, setHovered] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ left: 0, top: 0 });
  const containerRef = useRef(null);
  const tooltipRef = useRef(null);

  const max = Math.max(...data.map(d => d.value), 1);
  const chartHeight = showXAxisLabels ? height - 24 : height;
  const labelWidth = 48;

  // Y-axis grid lines (5 steps)
  const gridSteps = 5;
  const gridValues = [];
  for (let i = 0; i <= gridSteps; i++) {
    gridValues.push(Math.round((max / gridSteps) * i));
  }

  useLayoutEffect(() => {
    if (hovered === null || !containerRef.current || !tooltipRef.current) return;
    const barEl = containerRef.current.querySelector(`[data-index="${hovered}"]`);
    if (!barEl) return;
    const barRect = barEl.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const barCenterX = barRect.left + barRect.width / 2;
    let leftPx = barCenterX;
    const halfWidth = tooltipRect.width / 2;
    const margin = 8;
    if (leftPx - halfWidth < margin) leftPx = halfWidth + margin;
    else if (leftPx + halfWidth > window.innerWidth - margin) leftPx = window.innerWidth - halfWidth - margin;
    const topPx = barRect.bottom + 8;
    setTooltipPos({ left: leftPx, top: topPx });
  }, [hovered]);

  return (
    <div className={className}>
      <div className="flex">
        {/* Y-axis labels */}
        <div className="flex flex-col justify-between items-end pr-2" style={{ height: `${chartHeight}px`, width: `${labelWidth}px` }}>
          {gridValues.slice().reverse().map((v, i) => (
            <div key={i} className="text-xs text-gray-500 dark:text-gray-400 leading-none">
              {formatValue ? formatValue(v) : v}
            </div>
          ))}
        </div>

        {/* Chart area */}
        <div ref={containerRef} className="relative flex-1" style={{ height: `${chartHeight}px` }}>
          {/* Grid lines */}
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {gridValues.map((_, i) => (
              <div key={i} className="border-t border-gray-200 dark:border-gray-600" style={{ height: 0 }} />
            ))}
          </div>
          {/* Bars */}
          <div className="flex items-end gap-0.5 h-full w-full relative">
            {data.map((d, i) => {
              const barHeight = max > 0 ? `${(d.value / max) * 100}%` : '0%';
              const hasSecondary = d.upscaleCost !== undefined && d.upscaleCost > 0;
              const secondaryValue = hasSecondary ? d.upscaleCost : 0;
              const primaryValue = d.value - secondaryValue;
              const primaryHeightPct = max > 0 ? (primaryValue / max) * 100 : 0;
              const secondaryHeightPct = max > 0 ? (secondaryValue / max) * 100 : 0;
              return (
                <div
                  key={i}
                  data-index={i}
                  className="flex-1 min-w-0 transition-colors cursor-pointer rounded-t overflow-hidden relative flex flex-col justify-end"
                  style={{
                    height: barHeight,
                    minHeight: d.value > 0 ? '2px' : '0',
                  }}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                >
                  {hasSecondary && (
                    <div
                      className="w-full transition-colors"
                      style={{
                        height: `${secondaryHeightPct}%`,
                        minHeight: secondaryValue > 0 ? '1px' : '0',
                        backgroundColor: hovered === i ? secondaryHoverColor : secondaryColor,
                      }}
                    />
                  )}
                  <div
                    className="w-full transition-colors"
                    style={{
                      height: hasSecondary ? `${primaryHeightPct}%` : '100%',
                      minHeight: primaryValue > 0 ? '1px' : '0',
                      backgroundColor: hovered === i ? barHoverColor : barColor,
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* X-axis labels */}
      {showXAxisLabels && (
        <div className="flex">
          <div style={{ width: `${labelWidth}px` }} />
          <div className="flex gap-0.5 flex-1">
            {data.map((d, i) => (
              <div key={i} className="flex-1 min-w-0 text-center text-xs text-gray-500 dark:text-gray-400 leading-6 overflow-hidden" title={d.title || d.label}>
                {d.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {hovered !== null && data[hovered] && createPortal(
        <div
          ref={tooltipRef}
          className="fixed z-[60] pointer-events-none"
          style={{
            left: `${tooltipPos.left}px`,
            top: `${tooltipPos.top}px`,
            transform: 'translateX(-50%)',
          }}
        >
          <div className="relative bg-[#003cbf] border border-[#003cbf] rounded-lg shadow-lg px-3 py-2 text-sm text-white whitespace-nowrap">
            <div className="absolute -top-2 w-0 h-0 border-l-8 border-r-8 border-b-8 border-l-transparent border-r-transparent border-b-[#003cbf]" style={{ left: '50%', transform: 'translateX(-50%)' }} />
            <div className="font-medium">{data[hovered].title || data[hovered].label}</div>
            {data[hovered].upscaleCost !== undefined ? (
              <>
                <div>{primaryLabel}: {formatValue ? formatValue(data[hovered].value - data[hovered].upscaleCost) : (data[hovered].value - data[hovered].upscaleCost)}</div>
                <div>{secondaryLabel}: {formatValue ? formatValue(data[hovered].upscaleCost) : data[hovered].upscaleCost}</div>
              </>
            ) : (
              <div>{formatValue ? formatValue(data[hovered].value) : data[hovered].value}</div>
            )}
            {data[hovered].totalTokens !== undefined && (
              <div className="mt-1 pt-1 border-t border-white/30 space-y-0.5 text-xs">
                <div>Tokens Used: {data[hovered].totalTokens.toLocaleString()}</div>
                <div>Text Input: {data[hovered].totalInputTextTokens.toLocaleString()}</div>
                <div>Image Input: {data[hovered].totalInputImageTokens.toLocaleString()}</div>
                <div>Output: {data[hovered].totalOutputTokens.toLocaleString()}</div>
                <div>Generations: {data[hovered].totalGenerations.toLocaleString()}</div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
