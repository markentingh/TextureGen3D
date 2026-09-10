import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from '@/context/session';
import { Billing } from '@/api/admin/billing';
import Tabs from '@/components/ui/tabs';
import Modal from '@/components/ui/modal';
import Spinner from '@/components/ui/spinner';

export default function BillingPage() {
  const { token } = useSession();
  const [activeTab, setActiveTab] = useState('subscriptions');

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Billing</h1>
      <Tabs
        tabs={[
          { id: 'subscriptions', label: 'Subscriptions', content: <SubscriptionsTab token={token} /> },
          { id: 'products', label: 'Products', content: <ProductsTab token={token} /> },
          { id: 'userSubscriptions', label: 'User Subscriptions', content: <UserSubscriptionsTab token={token} /> },
          { id: 'invoices', label: 'Invoices', content: <InvoicesTab token={token} /> },
        ]}
        defaultTab={activeTab}
        onTabChange={setActiveTab}
      />
    </div>
  );
}

function SubscriptionsTab({ token }) {
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ id: 0, title: '', monthlyProductId: null, yearlyProductId: null, featuresJson: '', status: 1 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const api = Billing({ token });
      const res = await api.getSubscriptions();
      if (res.data.success) setSubscriptions(res.data.data || []);
      else setError(res.data.message);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    try {
      const api = Billing({ token });
      const res = await api.saveSubscription(form);
      if (res.data.success) {
        setShowEdit(false);
        setEditing(null);
        await load();
      } else {
        setError(res.data.message);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  };

  const handleArchive = async (id) => {
    if (!confirm('Archive this subscription?')) return;
    try {
      const api = Billing({ token });
      await api.archiveSubscription(id);
      await load();
    } catch (err) {
      alert(err.response?.data?.message || err.message);
    }
  };

  const handleSetFeatured = async (id) => {
    try {
      const api = Billing({ token });
      await api.setFeaturedSubscription(id);
      await load();
    } catch (err) {
      alert(err.response?.data?.message || err.message);
    }
  };

  const openEdit = (sub) => {
    setEditing(sub);
    setForm({
      id: sub.id || 0,
      title: sub.title || '',
      monthlyProductId: sub.monthlyProductId || null,
      yearlyProductId: sub.yearlyProductId || null,
      featuresJson: sub.featuresJson || '',
      status: sub.status ?? 1,
    });
    setShowEdit(true);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ id: 0, title: '', monthlyProductId: null, yearlyProductId: null, featuresJson: '', status: 1 });
    setShowEdit(true);
  };

  if (loading) return <div className="flex justify-center py-8"><Spinner className="text-2xl" /></div>;

  return (
    <div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded text-sm">{error}</div>}
      <div className="flex justify-end mb-4">
        <button onClick={openCreate} className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition">Add Subscription</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-sm">
              <th className="py-2 px-3">Title</th>
              <th className="py-2 px-3">Monthly Product</th>
              <th className="py-2 px-3">Yearly Product</th>
              <th className="py-2 px-3">Status</th>
              <th className="py-2 px-3">Featured</th>
              <th className="py-2 px-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.map((sub) => (
              <tr key={sub.id} className="border-b border-gray-100 dark:border-gray-800">
                <td className="py-2 px-3">{sub.title}</td>
                <td className="py-2 px-3">{sub.monthlyProductId ?? '-'}</td>
                <td className="py-2 px-3">{sub.yearlyProductId ?? '-'}</td>
                <td className="py-2 px-3">{sub.status === 1 ? 'Active' : 'Inactive'}</td>
                <td className="py-2 px-3">{sub.featured ? 'Yes' : 'No'}</td>
                <td className="py-2 px-3">
                  <button onClick={() => openEdit(sub)} className="text-primary-600 hover:underline mr-2">Edit</button>
                  <button onClick={() => handleSetFeatured(sub.id)} className="text-blue-600 hover:underline mr-2">Feature</button>
                  <button onClick={() => handleArchive(sub.id)} className="text-red-600 hover:underline">Archive</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showEdit && (
        <Modal title={editing ? 'Edit Subscription' : 'Add Subscription'} onClose={() => setShowEdit(false)}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Title</label>
              <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Monthly Product ID</label>
              <input type="number" value={form.monthlyProductId ?? ''} onChange={(e) => setForm({ ...form, monthlyProductId: e.target.value ? parseInt(e.target.value) : null })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Yearly Product ID</label>
              <input type="number" value={form.yearlyProductId ?? ''} onChange={(e) => setForm({ ...form, yearlyProductId: e.target.value ? parseInt(e.target.value) : null })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Features JSON</label>
              <textarea value={form.featuresJson} onChange={(e) => setForm({ ...form, featuresJson: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800" rows={4} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800">
                <option value={1}>Active</option>
                <option value={0}>Inactive</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={() => setShowEdit(false)} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition">Cancel</button>
            <button onClick={handleSave} className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition">Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ProductsTab({ token }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState({ id: 0, title: '', price: 0, tokens: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const api = Billing({ token });
      const res = await api.getProducts();
      if (res.data.success) setProducts(res.data.data || []);
      else setError(res.data.message);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    try {
      const api = Billing({ token });
      const res = await api.saveProduct(form);
      if (res.data.success) {
        setShowEdit(false);
        await load();
      } else {
        setError(res.data.message);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    }
  };

  const handleArchive = async (id) => {
    if (!confirm('Archive this product?')) return;
    try {
      const api = Billing({ token });
      await api.archiveProduct(id);
      await load();
    } catch (err) {
      alert(err.response?.data?.message || err.message);
    }
  };

  const openEdit = (product) => {
    setForm({ id: product.id || 0, title: product.title || '', price: product.price || 0, tokens: product.tokens || 0 });
    setShowEdit(true);
  };

  const openCreate = () => {
    setForm({ id: 0, title: '', price: 0, tokens: 0 });
    setShowEdit(true);
  };

  if (loading) return <div className="flex justify-center py-8"><Spinner className="text-2xl" /></div>;

  return (
    <div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded text-sm">{error}</div>}
      <div className="flex justify-end mb-4">
        <button onClick={openCreate} className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition">Add Product</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-sm">
              <th className="py-2 px-3">Title</th>
              <th className="py-2 px-3">Price</th>
              <th className="py-2 px-3">Tokens</th>
              <th className="py-2 px-3">Archived</th>
              <th className="py-2 px-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-b border-gray-100 dark:border-gray-800">
                <td className="py-2 px-3">{product.title}</td>
                <td className="py-2 px-3">${(product.price / 100).toFixed(2)}</td>
                <td className="py-2 px-3">{product.tokens.toLocaleString()}</td>
                <td className="py-2 px-3">{product.archived ? 'Yes' : 'No'}</td>
                <td className="py-2 px-3">
                  <button onClick={() => openEdit(product)} className="text-primary-600 hover:underline mr-2">Edit</button>
                  <button onClick={() => handleArchive(product.id)} className="text-red-600 hover:underline">Archive</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showEdit && (
        <Modal title={form.id ? 'Edit Product' : 'Add Product'} onClose={() => setShowEdit(false)}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Title</label>
              <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Price (cents)</label>
              <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tokens</label>
              <input type="number" value={form.tokens} onChange={(e) => setForm({ ...form, tokens: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800" />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={() => setShowEdit(false)} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition">Cancel</button>
            <button onClick={handleSave} className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition">Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function UserSubscriptionsTab({ token }) {
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const api = Billing({ token });
      const res = await api.getUserSubscriptions();
      if (res.data.success) setSubscriptions(res.data.data || []);
      else setError(res.data.message);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleCancel = async (id) => {
    if (!confirm('Cancel this subscription?')) return;
    try {
      const api = Billing({ token });
      await api.cancelUserSubscription(id);
      await load();
    } catch (err) {
      alert(err.response?.data?.message || err.message);
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Spinner className="text-2xl" /></div>;

  return (
    <div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded text-sm">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-sm">
              <th className="py-2 px-3">Email</th>
              <th className="py-2 px-3">Subscription ID</th>
              <th className="py-2 px-3">Start Date</th>
              <th className="py-2 px-3">End Date</th>
              <th className="py-2 px-3">Cancelled</th>
              <th className="py-2 px-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.map((sub) => (
              <tr key={sub.id} className="border-b border-gray-100 dark:border-gray-800">
                <td className="py-2 px-3">{sub.email || sub.appUserId}</td>
                <td className="py-2 px-3">{sub.subscriptionId}</td>
                <td className="py-2 px-3">{sub.startDate ? new Date(sub.startDate).toLocaleDateString() : '-'}</td>
                <td className="py-2 px-3">{sub.endDate ? new Date(sub.endDate).toLocaleDateString() : '-'}</td>
                <td className="py-2 px-3">{sub.cancelled ? 'Yes' : 'No'}</td>
                <td className="py-2 px-3">
                  {!sub.cancelled && (
                    <button onClick={() => handleCancel(sub.id)} className="text-red-600 hover:underline">Cancel</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InvoicesTab({ token }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const api = Billing({ token });
      const res = await api.getInvoices();
      if (res.data.success) setInvoices(res.data.data || []);
      else setError(res.data.message);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-8"><Spinner className="text-2xl" /></div>;

  return (
    <div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded text-sm">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-sm">
              <th className="py-2 px-3">ID</th>
              <th className="py-2 px-3">User ID</th>
              <th className="py-2 px-3">Subscription ID</th>
              <th className="py-2 px-3">Product ID</th>
              <th className="py-2 px-3">Price</th>
              <th className="py-2 px-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-b border-gray-100 dark:border-gray-800">
                <td className="py-2 px-3">{inv.id}</td>
                <td className="py-2 px-3 text-xs">{inv.appUserId}</td>
                <td className="py-2 px-3">{inv.subscriptionId}</td>
                <td className="py-2 px-3">{inv.productId}</td>
                <td className="py-2 px-3">${(inv.price / 100).toFixed(2)}</td>
                <td className="py-2 px-3">{inv.dateCreated ? new Date(inv.dateCreated).toLocaleDateString() : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
