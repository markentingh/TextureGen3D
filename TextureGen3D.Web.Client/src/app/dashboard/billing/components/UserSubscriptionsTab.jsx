import React, { useState, useEffect, useCallback } from 'react';
import ButtonIcon from '@/components/ui/button-icon';
import ButtonOutline from '@/components/ui/button-outline';
import Icon from '@/components/ui/icon';
import SubscribeModal from './SubscribeModal';
import UserSubscriptionDetails from './UserSubscriptionDetails';

export default function UserSubscriptionsTab({ api, showMessage }) {
  const [subscriptions, setSubscriptions] = useState([]);
  const [products, setProducts] = useState([]);
  const [allSubscriptions, setAllSubscriptions] = useState([]);
  const [showSubscribeModal, setShowSubscribeModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedAppUserId, setSelectedAppUserId] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [userRes, subRes, prodRes] = await Promise.all([
      api.getUserSubscriptions(),
      api.getSubscriptions(),
      api.getProducts(),
    ]);
    if (userRes.data.success) setSubscriptions(userRes.data.data);
    if (subRes.data.success) setAllSubscriptions(subRes.data.data);
    if (prodRes.data.success) setProducts(prodRes.data.data);
    setLoading(false);
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const handleStarted = (result) => {
    showMessage('info', `User Subscription ${result.subscriptionTitle} successfully added for ${result.email}`);
    load();
  };

  const handleCancel = async (id) => {
    const res = await api.cancelUserSubscription(id);
    if (res.data.success) {
      showMessage('info', 'User subscription cancelled.');
      load();
    }
  };

  return (
    <div>
      <div className="tool-bar mb-4">
        <div className="right-side">
          <ButtonOutline onClick={() => setShowSubscribeModal(true)}>
            <Icon name="add" />
            <span className="ml-2">Subscribe</span>
          </ButtonOutline>
        </div>
      </div>
      <SubscribeModal
        show={showSubscribeModal}
        subscriptions={allSubscriptions}
        products={products}
        api={api}
        onClose={() => setShowSubscribeModal(false)}
        onStarted={handleStarted}
      />
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-gray-100 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Subscription</th>
              <th className="px-4 py-3">Start Date</th>
              <th className="px-4 py-3">End Date</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.map(s => (
              <tr key={s.id} className="border-b border-gray-200 dark:border-gray-700">
                <td className="px-4 py-3 text-sm">{s.email || s.appUserId}</td>
                <td className="px-4 py-3">{allSubscriptions.find(sub => sub.id === s.subscriptionId)?.title || `#${s.subscriptionId}`}</td>
                <td className="px-4 py-3">{new Date(s.startDate).toLocaleDateString()}</td>
                <td className="px-4 py-3">{s.endDate ? new Date(s.endDate).toLocaleDateString() : '-'}</td>
                <td className="px-4 py-3">
                  {s.cancelled
                    ? <span className="text-red-600">Cancelled</span>
                    : <span className="text-green-600">Active</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ButtonIcon name="edit" onClick={() => { setSelectedAppUserId(s.appUserId); setShowDetailsModal(true); }} title="Details" />
                    {!s.cancelled && (
                      <ButtonIcon name="delete" color="red" onClick={() => handleCancel(s.id)} title="Cancel" />
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {subscriptions.length === 0 && (
              <tr>
                <td colSpan="6" className="text-center py-8 text-gray-600 dark:text-gray-400">
                  No user subscriptions found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <UserSubscriptionDetails
        show={showDetailsModal}
        appUserId={selectedAppUserId}
        api={api}
        onClose={() => setShowDetailsModal(false)}
      />
    </div>
  );
}
