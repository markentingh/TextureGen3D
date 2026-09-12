import React, { useState, useEffect } from 'react';

export default function InvoicesTab({ api }) {
  const [invoices, setInvoices] = useState([]);

  useEffect(() => {
    api.getInvoices().then(res => {
      if (res.data.success) setInvoices(res.data.data);
    });
  }, [api]);

  return (
    <div>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-gray-100 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">User ID</th>
              <th className="px-4 py-3">Subscription ID</th>
              <th className="px-4 py-3">Product ID</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map(inv => (
              <tr key={inv.id} className="border-b border-gray-200 dark:border-gray-700">
                <td className="px-4 py-3">{inv.id}</td>
                <td className="px-4 py-3 text-sm">{inv.appUserId}</td>
                <td className="px-4 py-3">{inv.subscriptionId}</td>
                <td className="px-4 py-3">{inv.productId}</td>
                <td className="px-4 py-3">${(inv.price / 100).toFixed(2)}</td>
                <td className="px-4 py-3">{new Date(inv.dateCreated).toLocaleDateString()}</td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan="6" className="text-center py-8 text-gray-600 dark:text-gray-400">
                  No invoices found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
