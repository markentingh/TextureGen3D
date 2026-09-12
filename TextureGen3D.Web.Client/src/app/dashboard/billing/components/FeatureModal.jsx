import React, { useState } from 'react';
import Modal from '@/components/ui/modal';
import Input from '@/components/forms/input';
import Select from '@/components/forms/select';
import ButtonOutline from '@/components/ui/button-outline';
import Icon from '@/components/ui/icon';
import { ICON_OPTIONS, getIconName } from '@/helpers/icons';

export default function FeatureModal({ show, feature, onSave, onClose }) {
  const [text, setText] = useState(feature?.text || '');
  const [icon, setIcon] = useState(feature?.icon || 'dot');

  if (!show) return null;

  const handleSave = () => {
    if (!text.trim()) return;
    onSave({ text: text.trim(), icon });
  };

  return (
    <Modal
      title={feature ? 'Edit Feature' : 'Add Feature'}
      onClose={onClose}
    >
      <div>
        <div className="grid grid-cols-1 gap-4">
          <Input label="Feature" name="text" value={text} onChange={(e) => setText(e.target.value)} required autoFocus />
          <div className="flex items-end gap-3">
            <div>
              <Select label="Icon" name="icon" value={icon} onChange={(e) => setIcon(e.target.value)}
                options={ICON_OPTIONS.map(o => ({ value: o.value, label: o.label }))} required />
            </div>
            <div className="pb-5">
              <Icon name={getIconName(icon)} className="text-2xl text-primary-600 dark:text-primary-400" />
            </div>
          </div>
        </div>
        <div className="buttons mt-6 flex justify-end gap-2">
          <ButtonOutline color="gray" onClick={onClose} className="cancel">Cancel</ButtonOutline>
          <ButtonOutline onClick={handleSave}>Save</ButtonOutline>
        </div>
      </div>
    </Modal>
  );
}
