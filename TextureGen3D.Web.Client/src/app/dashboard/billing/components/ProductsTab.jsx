import React, { useState, useEffect, useCallback } from 'react';
import { useModal } from '@/context/modal';
import ButtonOutline from '@/components/ui/button-outline';
import ButtonIcon from '@/components/ui/button-icon';
import Icon from '@/components/ui/icon';
import ProductModal from './ProductModal';

export default function ProductsTab({ api, showMessage }) {
  const { showModal, hideModal } = useModal();
  const [products, setProducts] = useState([]);

  const load = useCallback(async () => {
    const res = await api.getProducts();
    if (res.data.success) setProducts(res.data.data);
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (product) => {
    const res = await api.saveProduct(product);
    if (res.data.success) {
      showMessage('info', 'Product saved successfully.');
      hideModal();
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
          <ButtonOutline onClick={() => showModal({ title: 'Add Product', body: <ProductModal product={null} onSave={handleSave} onClose={hideModal} /> })}>
            <Icon name="add" />
            <span className="ml-2">Add Product</span>
          </ButtonOutline>
        </div>
      </div>
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
                    <ButtonIcon name="edit" onClick={() => showModal({ title: 'Edit Product', body: <ProductModal product={p} onSave={handleSave} onClose={hideModal} /> })} title="Edit" />
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
