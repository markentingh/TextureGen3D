import React, { useState } from 'react';
import Modal from '@/components/ui/modal';
import Input from '@/components/forms/input';
import Select from '@/components/forms/select';
import ButtonOutline from '@/components/ui/button-outline';
import ButtonIcon from '@/components/ui/button-icon';
import Icon from '@/components/ui/icon';
import { List, Item } from '@/components/ui/list';
import FeatureModal from './FeatureModal';
import { getIconName } from '@/helpers/icons';

function FeatureList({ features, setFeatures, label }) {
  const [showModal, setShowModal] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [modalKey, setModalKey] = useState(0);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const editingFeature = editingIndex !== null ? features[editingIndex] : null;

  const handleAdd = () => {
    setEditingIndex(null);
    setModalKey(k => k + 1);
    setShowModal(true);
  };

  const handleEdit = (index) => {
    setEditingIndex(index);
    setModalKey(k => k + 1);
    setShowModal(true);
  };

  const handleDelete = (index) => {
    setFeatures(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = (feature) => {
    if (editingIndex !== null) {
      setFeatures(prev => prev.map((f, i) => i === editingIndex ? feature : f));
    } else {
      setFeatures(prev => [...prev, feature]);
    }
    setShowModal(false);
    setEditingIndex(null);
  };

  const handleClose = () => {
    setShowModal(false);
    setEditingIndex(null);
  };

  const handleDragStart = (index) => (e) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (index) => (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragIndex !== null && dragIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (index) => (e) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== index) {
      setFeatures(prev => {
        const reordered = [...prev];
        const [moved] = reordered.splice(dragIndex, 1);
        reordered.splice(index, 0, moved);
        return reordered;
      });
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
        <ButtonIcon name="add" onClick={handleAdd} title="Add Feature" />
      </div>
      {features.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-2">No features added yet.</p>
      ) : (
        <List inModal>
          {features.map((feature, index) => (
            <Item
              key={index}
              inModal
              draggable
              onDragStart={handleDragStart(index)}
              onDragOver={handleDragOver(index)}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop(index)}
              onDragEnd={handleDragEnd}
              className={`gap-2 ${dragIndex === index ? 'opacity-40' : ''} ${dragOverIndex === index ? 'shadow-[inset_0_2px_0_0_#3b82f6,inset_0_-2px_0_0_#3b82f6,inset_2px_0_0_0_#3b82f6,inset_-2px_0_0_0_#3b82f6]' : ''}`}
            >
              <span className="cursor-grab text-gray-400 dark:text-gray-500 flex-shrink-0 flex items-center">
                <Icon name="drag_indicator" />
              </span>
              <Icon name={getIconName(feature.icon)} className="text-lg text-primary-600 dark:text-primary-400" />
              <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{feature.text}</span>
              <ButtonIcon name="edit" onClick={() => handleEdit(index)} title="Edit" />
              <ButtonIcon name="delete" color="red" onClick={() => handleDelete(index)} title="Delete" />
            </Item>
          ))}
        </List>
      )}
      <FeatureModal
        key={modalKey}
        show={showModal}
        feature={editingFeature}
        onSave={handleSave}
        onClose={handleClose}
      />
    </div>
  );
}

export default function SubscriptionModal({ show, subscription, products, onSave, onClose }) {
  const [form, setForm] = useState({
    id: subscription?.id || 0,
    title: subscription?.title || '',
    status: subscription?.status ?? 1,
    monthlyProductId: subscription?.monthlyProductId ?? (products[0]?.id ?? 0),
    yearlyProductId: subscription?.yearlyProductId ?? (products[0]?.id ?? 0)
  });

  const parsedFeatures = (() => {
    try {
      const parsed = subscription?.featuresJson ? JSON.parse(subscription.featuresJson) : {};
      return {
        monthly: Array.isArray(parsed.monthly) ? parsed.monthly : [],
        yearly: Array.isArray(parsed.yearly) ? parsed.yearly : []
      };
    } catch {
      return { monthly: [], yearly: [] };
    }
  })();

  const [monthlyFeatures, setMonthlyFeatures] = useState(parsedFeatures.monthly);
  const [yearlyFeatures, setYearlyFeatures] = useState(parsedFeatures.yearly);

  if (!show) return null;

  const handleChange = (field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }));
  };

  const handleSave = () => {
    const monthlyId = parseInt(form.monthlyProductId);
    const yearlyId = parseInt(form.yearlyProductId);
    const status = parseInt(form.status);
    onSave({
      ...form,
      status: isNaN(status) ? 1 : status,
      monthlyProductId: isNaN(monthlyId) ? null : monthlyId,
      yearlyProductId: isNaN(yearlyId) ? null : yearlyId,
      featuresJson: JSON.stringify({
        monthly: monthlyFeatures.filter(f => f && f.text && f.text.trim()),
        yearly: yearlyFeatures.filter(f => f && f.text && f.text.trim())
      })
    });
  };

  const productOptions = products.map(p => ({ value: p.id, label: p.title }));

  return (
    <Modal
      title={subscription ? 'Edit Subscription' : 'Add Subscription'}
      onClose={onClose}
      className="w-full max-w-[900px] rounded-lg bg-white dark:bg-gray-800 shadow-xl"
    >
      <div>
        <div className="grid grid-cols-1 gap-4">
          <Input label="Title" name="title" value={form.title} onChange={handleChange('title')} required autoFocus />
          <Select
            label="Status"
            name="status"
            value={form.status}
            onChange={handleChange('status')}
            options={[
              { value: 0, label: 'Inactive' },
              { value: 1, label: 'Active' },
              { value: 2, label: 'Private' },
            ]}
            fitContent
          />
        </div>
        <div className="grid grid-cols-2 gap-6 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">Monthly Plan</h3>
            <Select label="Product" name="monthlyProductId" value={form.monthlyProductId} onChange={handleChange('monthlyProductId')}
              options={productOptions} fitContent />
            <div className="mt-4">
              <FeatureList features={monthlyFeatures} setFeatures={setMonthlyFeatures} label="Features" />
            </div>
          </div>
          <div>
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">Yearly Plan</h3>
            <Select label="Product" name="yearlyProductId" value={form.yearlyProductId} onChange={handleChange('yearlyProductId')}
              options={productOptions} fitContent />
            <div className="mt-4">
              <FeatureList features={yearlyFeatures} setFeatures={setYearlyFeatures} label="Features" />
            </div>
          </div>
        </div>
        <div className="buttons mt-6 flex justify-end gap-2">
          <ButtonOutline color="gray" onClick={onClose} className="cancel">Cancel</ButtonOutline>
          <ButtonOutline onClick={handleSave}>Save Changes</ButtonOutline>
        </div>
      </div>
    </Modal>
  );
}
