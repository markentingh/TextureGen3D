import React, { useState, useEffect, useCallback } from 'react';
import Modal from '@/components/ui/modal';
import Spinner from '@/components/ui/spinner';
import Pagination from '@/components/ui/pagination';
import ButtonOutline from '@/components/ui/button-outline';
import AddUserTokens from './AddUserTokens';

const PAGE_SIZE = 10;

export default function UserSubscriptionDetails({ show, appUserId, api, onClose }) {
  const [details, setDetails] = useState(null);
  const [tokens, setTokens] = useState([]);
  const [tokenTotal, setTokenTotal] = useState(0);
  const [tokenPage, setTokenPage] = useState(1);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [showAddTokens, setShowAddTokens] = useState(false);

  const loadDetails = useCallback(async () => {
    if (!appUserId) return;
    setLoadingDetails(true);
    try {
      const res = await api.getUserSubscriptionDetails(appUserId);
      if (res.data.success) {
        setDetails(res.data.data);
      } else {
        setDetails(null);
      }
    } catch {
      setDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  }, [appUserId, api]);

  const loadTokens = useCallback(async (page) => {
    if (!appUserId) return;
    setLoadingTokens(true);
    try {
      const res = await api.getUserAITokens(appUserId, page, PAGE_SIZE);
      if (res.data.success) {
        const data = res.data.data;
        setTokens(data.items || []);
        setTokenTotal(data.total || 0);
        setTokenPage(data.page || 1);
      } else {
        setTokens([]);
        setTokenTotal(0);
      }
    } catch {
      setTokens([]);
      setTokenTotal(0);
    } finally {
      setLoadingTokens(false);
    }
  }, [appUserId, api]);

  useEffect(() => {
    if (show && appUserId) {
      loadDetails();
      loadTokens(1);
    }
  }, [show, appUserId, loadDetails, loadTokens]);

  const totalPages = Math.ceil(tokenTotal / PAGE_SIZE);

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
  };

  const formatBillingMonth = (billingMonth) => {
    if (!billingMonth) return '-';
    const d = new Date(billingMonth);
    const now = new Date();
    const isCurrent = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (isCurrent) {
      return <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">Current</span>;
    }
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const formatTokens = (n) => (n || 0).toLocaleString();

  if (!show) return null;

  return (
    <Modal title="User Subscription Details" onClose={onClose} className="max-w-3xl w-full">
      {/* Subscription details section */}
      {loadingDetails ? (
        <div className="flex justify-center py-8">
          <Spinner className="text-2xl" />
        </div>
      ) : details ? (
        <div className="mb-6 grid grid-cols-2 gap-4">
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">Email</span>
            <p className="text-sm font-medium">{details.email}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">Subscription</span>
            <p className="text-sm font-medium">{details.subscriptionTitle}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">Product</span>
            <p className="text-sm font-medium">{details.productTitle}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">Price</span>
            <p className="text-sm font-medium">${((details.price || 0) / 100).toFixed(2)}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">Start Date</span>
            <p className="text-sm font-medium">{formatDate(details.startDate)}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">End Date</span>
            <p className="text-sm font-medium">{formatDate(details.endDate)}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">Unused Tokens</span>
            <p className="text-sm font-medium">{formatTokens(details.unusedTokens)}</p>
          </div>
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">Status</span>
            <p className="text-sm font-medium">
              {details.cancelled
                ? <span className="text-red-600">Cancelled</span>
                : <span className="text-green-600">Active</span>}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No active subscription found.</p>
      )}

      {/* AI Tokens table */}
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">AI Token History</h4>
        <ButtonOutline size="small" onClick={() => setShowAddTokens(true)}>+ Add Tokens</ButtonOutline>
      </div>
      {loadingTokens ? (
        <div className="flex justify-center py-8">
          <Spinner className="text-2xl" />
        </div>
      ) : tokens.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-100 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-2">Tokens Purchased</th>
                  <th className="px-4 py-2">Tokens Used</th>
                  <th className="px-4 py-2">Tokens Available</th>
                  <th className="px-4 py-2">Billing Month</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => {
                  const billingDate = new Date(t.billingMonth);
                  const now = new Date();
                  const isCurrent = billingDate.getFullYear() === now.getFullYear() && billingDate.getMonth() === now.getMonth();
                  const available = isCurrent ? (t.tokens - t.tokensUsed) : 0;
                  return (
                    <tr key={t.id} className="border-t border-gray-200 dark:border-gray-700">
                      <td className="px-4 py-2">{formatTokens(t.tokens)}</td>
                      <td className="px-4 py-2">{formatTokens(t.tokensUsed)}</td>
                      <td className="px-4 py-2">{formatTokens(available)}</td>
                      <td className="px-4 py-2">{formatBillingMonth(t.billingMonth)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={tokenPage}
            totalPages={totalPages}
            totalItems={tokenTotal}
            pageSize={PAGE_SIZE}
            onPageChange={(p) => loadTokens(p)}
          />
        </>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No AI token records found.</p>
      )}
      <AddUserTokens
        show={showAddTokens}
        appUserId={appUserId}
        api={api}
        onClose={() => setShowAddTokens(false)}
        onAdded={() => loadTokens(1)}
      />
    </Modal>
  );
}
