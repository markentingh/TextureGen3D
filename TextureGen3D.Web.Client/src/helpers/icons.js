export const ICON_OPTIONS = [
  { value: 'dot', label: 'Dot', iconName: 'fiber_manual_record' },
  { value: 'star', label: 'Star', iconName: 'star' },
  { value: 'check', label: 'Checkmark', iconName: 'check' }
];

export function getIconName(value) {
  return ICON_OPTIONS.find(o => o.value === value)?.iconName || 'fiber_manual_record';
}
