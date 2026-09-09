import React, { useState, useRef, useEffect, useCallback } from 'react';
import Icon from '@/components/ui/icon';

let dropdownIdCounter = 0;

export default function SelectChecklist({
  name,
  options = [],
  values = [],
  onChange,
  placeholder = 'Select...',
  className = '',
  disabled = false,
  checkboxes = true,
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);
  const listenersRef = useRef(null);
  const valuesRef = useRef(values);
  const optionsRef = useRef(options);
  const onChangeRef = useRef(onChange);

  valuesRef.current = values;
  optionsRef.current = options;
  onChangeRef.current = onChange;

  const destroyDropdown = useCallback(() => {
    if (dropdownRef.current) {
      dropdownRef.current.remove();
      dropdownRef.current = null;
    }
    if (listenersRef.current) {
      document.removeEventListener('click', listenersRef.current.handler);
      window.removeEventListener('resize', listenersRef.current.reposition);
      window.removeEventListener('scroll', listenersRef.current.reposition, true);
      listenersRef.current = null;
    }
  }, []);

  const checkboxesRef = useRef(checkboxes);
  checkboxesRef.current = checkboxes;

  const buildDropdownHTML = (opts, vals) => {
    if (opts.length === 0) {
      return '<div class="px-3 py-2 text-sm text-gray-400">No options</div>';
    }
    return opts.map((option) => {
      const checked = vals.includes(option.value);
      const escapedLabel = option.label
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"');
      let noteHtml = '';
      if (option.note) {
        const escapedNoteText = (option.note.text || '')
          .replace(/&/g, '&')
          .replace(/</g, '<')
          .replace(/>/g, '>')
          .replace(/"/g, '"');
        const noteColor = option.note.type === 'red' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400';
        noteHtml = `<span class="text-xs font-bold ${noteColor} whitespace-nowrap ml-auto">${escapedNoteText}</span>`;
      }
      const cbHtml = checkboxesRef.current
        ? `<input type="checkbox" ${checked ? 'checked' : ''} class="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 select-checklist-cb" />`
        : '';
      const colorHtml = option.hexColor
        ? `<span class="flex items-center gap-1 mr-2">${option.hexColor.split(',').map((h) => h.trim() ? `<span class="w-5 h-5 rounded-full border border-gray-300 dark:border-gray-600" style="background-color: #${h.trim()}; flex-shrink: 0;"></span>` : '').join('')}</span>`
        : '';
      return `<label class="flex items-center gap-2 px-3 py-2 ${checkboxesRef.current ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600' : ''}" data-value="${option.value}">
        ${cbHtml}
        ${colorHtml}
        <span class="text-sm">${escapedLabel}</span>
        ${noteHtml}
      </label>`;
    }).join('');
  };

  const repositionDropdown = useCallback(() => {
    if (!buttonRef.current || !dropdownRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const dropdown = dropdownRef.current;
    dropdown.style.position = 'fixed';
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.width = `${rect.width}px`;
    const maxH = window.innerHeight - rect.bottom - 8;
    dropdown.style.maxHeight = `${Math.max(80, maxH)}px`;
  }, []);

  const createDropdown = useCallback(() => {
    if (!buttonRef.current) return;

    const id = `select-checklist-dropdown-${++dropdownIdCounter}`;
    const dropdown = document.createElement('div');
    dropdown.id = id;
    dropdown.className = 'overflow-y-auto rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 shadow-lg';
    dropdown.style.zIndex = '9999';
    dropdown.innerHTML = buildDropdownHTML(optionsRef.current, valuesRef.current);

    document.body.appendChild(dropdown);
    dropdownRef.current = dropdown;

    requestAnimationFrame(() => repositionDropdown());
    setTimeout(repositionDropdown, 1);

    const handler = (e) => {
      if (dropdown.contains(e.target)) {
        if (checkboxesRef.current) {
          const label = e.target.closest('label[data-value]');
          if (label) {
            const checkedValues = Array.from(dropdown.querySelectorAll('label[data-value]'))
                .filter((l) => l.querySelector('.select-checklist-cb')?.checked)
                .map((l) => l.getAttribute('data-value'));
              if (onChangeRef.current) onChangeRef.current(checkedValues);
          }
        }
        return;
      }
      if (buttonRef.current && !buttonRef.current.contains(e.target)) {
        setOpen(false);
      }
    };

    const reposition = () => repositionDropdown();

    document.addEventListener('click', handler);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);

    listenersRef.current = { handler, reposition };
  }, [repositionDropdown]);

  useEffect(() => {
    if (open) {
      createDropdown();
    } else {
      destroyDropdown();
    }
    return () => destroyDropdown();
  }, [open]);

  const selectedOptions = options.filter((o) => values.includes(o.value));

  return (
    <div className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700 text-left text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 border-gray-300 dark:border-gray-600 disabled:opacity-50 flex items-center justify-between"
      >
        <span className={`flex-1 min-w-0 truncate whitespace-nowrap ${selectedOptions.length === 0 ? 'text-gray-400' : ''}`}>
          {selectedOptions.length === 0
            ? placeholder
            : selectedOptions.length === 1
              ? (
                <span className="inline-flex items-center gap-1">
                  {selectedOptions[0].hexColor && (
                    <span className="flex items-center gap-1">
                      {selectedOptions[0].hexColor.split(',').map((h, i) => {
                        const hc = h.trim();
                        if (!hc) return null;
                        return (
                          <span
                            key={i}
                            className="w-5 h-5 rounded-full border border-gray-300 dark:border-gray-600 flex-shrink-0"
                            style={{ backgroundColor: `#${hc}` }}
                            title={`#${hc}`}
                          />
                        );
                      })}
                    </span>
                  )}
                  <span className="text-sm whitespace-nowrap">{selectedOptions[0].label}</span>
                </span>
              )
              : 'Multiple Variant Colors'}
        </span>
        <Icon name="expand_more" className="text-gray-400 text-sm" />
      </button>
    </div>
  );
}
