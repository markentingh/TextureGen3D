import React, { useState, useEffect, useCallback } from 'react';
import ButtonOutline from '@/components/ui/button-outline';
import ButtonIcon from '@/components/ui/button-icon';
import Icon from '@/components/ui/icon';
import ProductModal from './ProductModal';

export default function ProductsTab({ api, showMessage }) {
  const [products, setProducts] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [modalKey, setModalKey] = useState(0);

  const load = useCallback(async () => {
    const res = await api.getProducts();
    if (res.data.success) setProducts(res.data.data);
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (product) => {
    const res = await api.saveProduct(product);
    if (res.data.success) {
      showMessage('info', 'Product saved successfully.');
      setShowModal(false);
      setEditing(null);
      load();
    } else {
      showMessage('error', res.data.message || 'Failed to save product.');
    }
  };

  const handleArchive = async (id) => {
    const res = await api.archiveProduct(id);
    if (res.data.success) {
      showMessage('info', 'Product archived.');
      load();
    }
  };

  return (
    <div>
      <div className="tool-bar mb-4">
        <div className="right-side">
          <ButtonOutline onClick={() => { setEditing(null); setModalKey(k => k + 1); setShowModal(true); }}>
            <Icon name="add" />
            <span className="ml-2">Add Product</span>
          </ButtonOutline>
        </div>
      </div>
      <ProductModal
        key={modalKey}
        show={showModal}
        product={editing}
        onSave={handleSave}
        onClose={() => { setShowModal(false); setEditing(null); }}
      />
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-gray-100 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Tokens</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {products.map(p => (
              <tr key={p.id} className="border-b border-gray-200 dark:border-gray-700">
                <td className="px-4 py-3">{p.title}</td>
                <td className="px-4 py-3">${(p.price / 100).toFixed(2)}</td>
                <td className="px-4 py-3">{p.tokens.toLocaleString()}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ButtonIcon name="edit" onClick={() => { setEditing(p); setModalKey(k => k + 1); setShowModal(true); }} title="Edit" />
                    <ButtonIcon name="delete" color="red" onClick={() => handleArchive(p.id)} title="Archive" />
                  </div>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan="4" className="text-center py-8 text-gray-600 dark:text-gray-400">
                  No products configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
