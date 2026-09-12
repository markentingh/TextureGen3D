import React, { useState, useEffect, useMemo } from 'react';
import Modal from '@/components/ui/modal';
import Select from '@/components/forms/select';
import ButtonOutline from '@/components/ui/button-outline';
import Spinner from '@/components/ui/spinner';

export default function AddUserTokens({ show, appUserId, api, onClose, onAdded }) {
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!show) return;
    setLoadingProducts(true);
    setMessage(null);
    api.getProducts()
      .then((res) => {
        if (res.data.success) {
          setProducts(res.data.data || []);
        }
      })
      .catch(() => setProducts([]))
      .finally(() => setLoadingProducts(false));
  }, [show, api]);

  const productOptions = useMemo(
    () =>
      products
        .filter((p) => !p.archived)
        .map((p) => ({
          value: String(p.id),
          label: `${p.title} — ${p.tokens.toLocaleString()} tokens ($${(p.price / 100).toFixed(2)})`,
        })),
    [products]
  );

  const selectedProduct = useMemo(
    () => products.find((p) => String(p.id) === selectedProductId),
    [products, selectedProductId]
  );

  const handleOkay = async () => {
    if (!selectedProductId) {
      setMessage({ type: 'error', text: 'Please select a product.' });
      return;
    }
    if (!appUserId) {
      setMessage({ type: 'error', text: 'User ID is missing.' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await api.addUserTokens({
        appUserId,
        productId: parseInt(selectedProductId),
      });
      if (res.data.success) {
        onAdded(res.data.data);
        onClose();
      } else {
        setMessage({ type: 'error', text: res.data.message || 'Failed to add tokens.' });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: error?.response?.data?.message || 'Failed to add tokens.',
      });
    } finally {
      setLoading(false);
    }
  };

  if (!show) return null;

  return (
    <Modal title="Add Tokens" onClose={onClose} className="max-w-lg w-full">
      {message && (
        <p className={`text-sm mb-4 ${message.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-600'}`}>
          {message.text}
        </p>
      )}
      {loadingProducts ? (
        <div className="flex justify-center py-8">
          <Spinner className="text-2xl" />
        </div>
      ) : (
        <>
          <Select
            label="Product"
            name="product"
            value={selectedProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
            options={productOptions}
            placeholder="Select a product"
          />
          {selectedProduct && (
            <div className="mt-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-sm">
              <div className="flex justify-between mb-1">
                <span className="text-gray-500 dark:text-gray-400">Tokens</span>
                <span className="font-medium">{selectedProduct.tokens.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Price</span>
                <span className="font-medium">${(selectedProduct.price / 100).toFixed(2)}</span>
              </div>
            </div>
          )}
          <div className="flex justify-end mt-4">
            <ButtonOutline onClick={handleOkay} disabled={loading || !selectedProductId}>
              {loading ? 'Adding...' : 'Okay'}
            </ButtonOutline>
          </div>
        </>
      )}
    </Modal>
  );
}
