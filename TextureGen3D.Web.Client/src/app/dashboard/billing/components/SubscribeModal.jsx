import React, { useMemo, useState } from 'react';
import Modal from '@/components/ui/modal';
import FindUser from '@/components/ui/find-user';
import Select from '@/components/forms/select';
import ButtonOutline from '@/components/ui/button-outline';

export default function SubscribeModal({ show, subscriptions, products, api, onClose, onStarted }) {
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const planOptions = useMemo(() => {
    const opts = [];
    subscriptions
      .filter((s) => s.status === 1 || s.status === 2)
      .forEach((s) => {
        const monthly = products.find((p) => p.id === s.monthlyProductId);
        const yearly = products.find((p) => p.id === s.yearlyProductId);
        if (monthly) {
          opts.push({
            value: `${s.id}|monthly`,
            label: `${s.title} - Monthly - $${(monthly.price / 100).toFixed(2)}`,
          });
        }
        if (yearly) {
          opts.push({
            value: `${s.id}|yearly`,
            label: `${s.title} - Yearly - $${(yearly.price / 100).toFixed(2)}`,
          });
        }
      });
    return opts;
  }, [subscriptions, products]);

  const handleStart = async () => {
    if (!selectedUser || !selectedPlan) {
      setMessage({ type: 'error', text: 'Please select a user and a plan.' });
      return;
    }
    const [subscriptionId, period] = selectedPlan.split('|');
    setLoading(true);
    setMessage(null);
    try {
      const res = await api.startUserSubscription({
        appUserId: selectedUser.id,
        subscriptionId: parseInt(subscriptionId),
        period,
      });
      if (res.data.success) {
        onStarted(res.data.data);
        onClose();
      } else {
        setMessage({ type: 'error', text: res.data.message || 'Failed to start subscription.' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error?.response?.data?.message || 'Failed to start subscription.' });
    } finally {
      setLoading(false);
    }
  };

  if (!show) return null;

  return (
    <Modal title="Subscribe User" onClose={onClose} className="max-w-lg w-full">
      {message && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-4">{message.text}</p>
      )}
      <div className="mb-4">
        <FindUser selectedUser={selectedUser} onSelect={setSelectedUser} />
      </div>
      <Select
        label="Subscription"
        name="subscriptionPlan"
        value={selectedPlan}
        onChange={(e) => setSelectedPlan(e.target.value)}
        options={planOptions}
        placeholder="Select a plan"
      />
      {selectedUser && (
        <div className="flex justify-end mt-4">
          <ButtonOutline onClick={handleStart} disabled={loading}>
            {loading ? 'Starting...' : 'Start Subscription'}
          </ButtonOutline>
        </div>
      )}
    </Modal>
  );
}
