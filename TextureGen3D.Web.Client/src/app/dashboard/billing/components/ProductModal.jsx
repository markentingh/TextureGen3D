import React, { useState } from 'react';
import Modal from '@/components/ui/modal';
import Input from '@/components/forms/input';
import ButtonOutline from '@/components/ui/button-outline';

export default function ProductModal({ show, product, onSave, onClose }) {
  const [form, setForm] = useState({
    id: product?.id || 0,
    title: product?.title || '',
    price: product?.price ? (product.price / 100).toFixed(2) : '0.00',
    tokens: product?.tokens || 0
  });

  if (!show) return null;

  const handleChange = (field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }));
  };

  const handleSave = () => {
    onSave({
      ...form,
      price: Math.round(parseFloat(form.price) * 100) || 0,
      tokens: parseInt(form.tokens) || 0
    });
  };

  return (
    <Modal
      title={product ? 'Edit Product' : 'Add Product'}
      onClose={onClose}
    >
      <div>
        <div className="grid grid-cols-1 gap-4">
          <Input label="Title" name="title" value={form.title} onChange={handleChange('title')} required autoFocus />
          <Input label="Price (USD)" name="price" type="number" step="0.01" min="0" prefix="$" value={form.price} onChange={handleChange('price')} required />
          <Input label="Tokens" name="tokens" type="number" value={form.tokens} onChange={handleChange('tokens')} required />
        </div>
        <div className="buttons mt-6 flex justify-end gap-2">
          <ButtonOutline color="gray" onClick={onClose} className="cancel">Cancel</ButtonOutline>
          <ButtonOutline onClick={handleSave}>Save</ButtonOutline>
        </div>
      </div>
    </Modal>
  );
}
