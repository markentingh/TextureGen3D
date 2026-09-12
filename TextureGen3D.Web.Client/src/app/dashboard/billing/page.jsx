import React, { useState } from 'react';
import { useSession } from '@/context/session';
import { Billing } from '@/api/admin/billing';
import Message from '@/components/ui/message';
import SubscriptionsTab from './components/SubscriptionsTab';
import ProductsTab from './components/ProductsTab';
import UserSubscriptionsTab from './components/UserSubscriptionsTab';
import InvoicesTab from './components/InvoicesTab';

export default function BillingPage() {
  const session = useSession();
  const api = Billing(session);
  const [activeTab, setActiveTab] = useState('subscriptions');
  const [message, setMessage] = useState(null);

  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const tabs = [
    { key: 'subscriptions', label: 'Subscriptions' },
    { key: 'products', label: 'Products' },
    { key: 'userSubscriptions', label: 'User Subscriptions' },
    { key: 'invoices', label: 'Invoices' }
  ];

  return (
    <div className="p-8">
      <h1 className="text-3xl mb-6">Billing</h1>
      {message && (
        <Message type={message.type} onClose={() => setMessage(null)}>
          {message.text}
        </Message>
      )}
      <div className="flex gap-4 mb-6 border-b border-gray-200 dark:border-gray-700">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`pb-2 px-2 text-sm font-medium transition ${
              activeTab === tab.key
                ? 'text-primary-600 dark:text-primary-500 border-b-2 border-primary-600 dark:border-primary-500'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === 'subscriptions' && <SubscriptionsTab api={api} showMessage={showMessage} />}
      {activeTab === 'products' && <ProductsTab api={api} showMessage={showMessage} />}
      {activeTab === 'userSubscriptions' && <UserSubscriptionsTab api={api} showMessage={showMessage} />}
      {activeTab === 'invoices' && <InvoicesTab api={api} />}
    </div>
  );
}
