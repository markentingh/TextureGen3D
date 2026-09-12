import React, { useEffect, useRef, useState } from 'react';
import { useSession } from '@/context/session';
import { Users } from '@/api/admin/users';
import Modal from '@/components/ui/modal';
import Input from '@/components/forms/input';
import ButtonIcon from '@/components/ui/button-icon';
import ButtonOutline from '@/components/ui/button-outline';
import { List, Item } from '@/components/ui/list';
import Icon from '@/components/ui/icon';

export default function FindUser({ selectedUser, onSelect }) {
  const session = useSession();
  const api = Users(session);
  const [showModal, setShowModal] = useState(false);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  const search = async (q) => {
    if (!q.trim()) {
      setUsers([]);
      setMessage(null);
      return;
    }
    setLoading(true);
    try {
      const res = await api.searchUsers(q.trim());
      if (res.data.success) {
        const items = res.data.data?.items || [];
        setUsers(items);
        if (items.length === 0) {
          setMessage({ type: 'info', text: 'No users found.' });
        } else {
          setMessage(null);
        }
      } else {
        setMessage({ type: 'error', text: res.data.message || 'Search failed.' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error?.response?.data?.message || 'Search failed.' });
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = () => {
    setShowModal(true);
    setQuery('');
    setUsers([]);
    setMessage(null);
    setLoading(false);
  };

  const handleClose = () => {
    setShowModal(false);
  };

  const handleChange = (e) => {
    const value = e.target.value;
    setQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 2000);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      clearTimeout(debounceRef.current);
      search(query);
    }
  };

  const handleSelect = (u) => {
    onSelect(u);
    handleClose();
  };

  const label = selectedUser ? `${selectedUser.fullName} - ${selectedUser.email}` : 'No User Selected';

  return (
    <div className="flex items-center justify-between w-full gap-4">
      <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{label}</span>
      <ButtonOutline onClick={handleOpen} size="small">Find User</ButtonOutline>
      {showModal && (
        <Modal title="Find User" onClose={handleClose} className="max-w-md w-full">
          <div className="flex items-center gap-2 mb-4">
            <Input
              name="userSearch"
              value={query}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder="Search by email..."
              autoFocus
              className="flex-1"
            />
            <ButtonIcon name="search" onClick={() => { clearTimeout(debounceRef.current); search(query); }} title="Search" />
          </div>
          {message && (
            <p className={`text-sm mb-2 ${message.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
              {message.text}
            </p>
          )}
          {!message && users.length === 0 && !loading && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Search for users</p>
          )}
          {loading && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2 flex items-center gap-2">
              <Icon name="progress_activity" spin className="w-4 h-4" />
              Searching...
            </p>
          )}
          {users.length > 0 && (
            <List inModal={true}>
              {users.map((u) => (
                <Item key={u.id} onClick={() => handleSelect(u)} className="cursor-pointer">
                  <div>
                    <p className="font-medium text-sm">{u.fullName}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{u.email}</p>
                  </div>
                </Item>
              ))}
            </List>
          )}
        </Modal>
      )}
    </div>
  );
}
