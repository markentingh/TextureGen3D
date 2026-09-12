import React, { useState, useEffect, useCallback } from 'react';
import ButtonOutline from '@/components/ui/button-outline';
import ButtonIcon from '@/components/ui/button-icon';
import Icon from '@/components/ui/icon';
import SubscriptionModal from './SubscriptionModal';

export default function SubscriptionsTab({ api, showMessage }) {
  const [subscriptions, setSubscriptions] = useState([]);
  const [products, setProducts] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [modalKey, setModalKey] = useState(0);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const load = useCallback(async () => {
    const [subRes, prodRes] = await Promise.all([api.getSubscriptions(), api.getProducts()]);
    if (subRes.data.success) setSubscriptions(subRes.data.data);
    if (prodRes.data.success) setProducts(prodRes.data.data);
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (subscription) => {
    const res = await api.saveSubscription(subscription);
    if (res.data.success) {
      showMessage('info', 'Subscription saved successfully.');
      setShowModal(false);
      setEditing(null);
      load();
    } else {
      showMessage('error', res.data.message || 'Failed to save subscription.');
    }
  };

  const handleArchive = async (id) => {
    const res = await api.archiveSubscription(id);
    if (res.data.success) {
      showMessage('info', 'Subscription archived.');
      load();
    }
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
      const reordered = [...subscriptions];
      const [moved] = reordered.splice(dragIndex, 1);
      reordered.splice(index, 0, moved);
      setSubscriptions(reordered);
      api.reorderSubscriptions(reordered.map(s => s.id));
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleSetFeatured = async (id) => {
    const res = await api.setFeaturedSubscription(id);
    if (res.data.success) {
      setSubscriptions(prev => prev.map(s => ({ ...s, featured: s.id === id })));
    }
  };

  const productLookup = products.reduce((acc, p) => { acc[p.id] = p; return acc; }, {});

  return (
    <div>
      <div className="tool-bar mb-4">
        <div className="right-side">
          <ButtonOutline onClick={() => { setEditing(null); setModalKey(k => k + 1); setShowModal(true); }}>
            <Icon name="add" />
            <span className="ml-2">Add Subscription</span>
          </ButtonOutline>
        </div>
      </div>
      <SubscriptionModal
        key={modalKey}
        show={showModal}
        subscription={editing}
        products={products}
        onSave={handleSave}
        onClose={() => { setShowModal(false); setEditing(null); }}
      />
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-gray-100 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-3 w-8"></th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Monthly Product</th>
              <th className="px-4 py-3">Yearly Product</th>
              <th className="px-4 py-3 w-24">Status</th>
              <th className="px-4 py-3 w-20">Featured</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.map((s, index) => (
              <tr
                key={s.id}
                draggable
                onDragStart={handleDragStart(index)}
                onDragOver={handleDragOver(index)}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop(index)}
                onDragEnd={handleDragEnd}
                className={`border-b border-gray-200 dark:border-gray-700 cursor-grab ${dragIndex === index ? 'opacity-40' : ''} ${dragOverIndex === index ? 'shadow-[inset_0_2px_0_0_#3b82f6,inset_0_-2px_0_0_#3b82f6,inset_2px_0_0_0_#3b82f6,inset_-2px_0_0_0_#3b82f6]' : ''}`}
              >
                <td className="px-4 py-3 text-gray-400 dark:text-gray-500">
                  <Icon name="drag_indicator" />
                </td>
                <td className="px-4 py-3">{s.title}</td>
                <td className="px-4 py-3">{productLookup[s.monthlyProductId]?.title || '-'}</td>
                <td className="px-4 py-3">{productLookup[s.yearlyProductId]?.title || '-'}</td>
                <td className="px-4 py-3">
                  {s.status === 1 ? 'Active' : s.status === 2 ? 'Private' : 'Inactive'}
                </td>
                <td className="px-4 py-3">
                  <input
                    type="radio"
                    name="featured"
                    checked={s.featured}
                    onChange={() => handleSetFeatured(s.id)}
                    className="w-4 h-4 text-blue-600 cursor-pointer"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ButtonIcon name="edit" onClick={() => { setEditing(s); setModalKey(k => k + 1); setShowModal(true); }} title="Edit" />
                    <ButtonIcon name="delete" color="red" onClick={() => handleArchive(s.id)} title="Archive" />
                  </div>
                </td>
              </tr>
            ))}
            {subscriptions.length === 0 && (
              <tr>
                <td colSpan="7" className="text-center py-8 text-gray-600 dark:text-gray-400">
                  No subscriptions configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
