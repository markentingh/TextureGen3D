import React, { useEffect, useState } from 'react';
import { useSession } from '@/context/session';
import { Users } from '@/api/admin/users';
import Modal from '@/components/ui/modal';
import Button from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import Input from '@/components/forms/input';
import ButtonOutline from '@/components/ui/button-outline';
import Pagination from '@/components/ui/pagination';
import Message from '@/components/ui/message';

const formatDate = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  return date.toLocaleString();
};

export default function DashboardUsers() {
  const session = useSession();
  const { getAllFiltered, updateFullName, sendPasswordReset } = Users(session);

  const [users, setUsers] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filter, setFilter] = useState({
    fullName: '',
    role: 0,
    sort: 'Email ASC',
    start: 0,
    length: 50
  });
  const [selectedUser, setSelectedUser] = useState(null);
  const [fullName, setFullName] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchUsers = () => {
    setLoading(true);
    getAllFiltered(filter).then((response) => {
      setLoading(false);
      if (response.data.success) {
        setUsers(response.data.data.items || []);
        setTotalCount(response.data.data.totalCount || 0);
      } else {
        setMessage({ type: 'error', text: response.data.message || 'Failed to fetch users' });
      }
    }).catch((error) => {
      setLoading(false);
      setMessage({ type: 'error', text: error?.response?.data?.message || 'Failed to fetch users' });
    });
  };

  useEffect(() => {
    fetchUsers();
  }, [filter.fullName, filter.role, filter.sort, filter.start, filter.length]);

  const handleSort = (column) => {
    const current = filter.sort;
    const [currentColumn] = current.split(' ');
    const direction = currentColumn === column && current.endsWith('ASC') ? 'DESC' : 'ASC';
    setFilter((prev) => ({ ...prev, sort: `${column} ${direction}`, start: 0 }));
  };

  const getSortIndicator = (column) => {
    if (!filter.sort.startsWith(column)) return null;
    return filter.sort.endsWith('ASC') ? '▲' : '▼';
  };

  const handleRowClick = (person) => {
    setSelectedUser(person);
    setFullName(person.fullName || '');
    setMessage(null);
  };

  const handleCloseModal = () => {
    setSelectedUser(null);
    setMessage(null);
  };

  const handleSaveFullName = () => {
    updateFullName({ Id: selectedUser.id, FullName: fullName }).then((response) => {
      if (response.data.success) {
        setMessage({ type: 'info', text: 'Full name updated' });
        setSelectedUser((prev) => ({ ...prev, fullName }));
        fetchUsers();
      } else {
        setMessage({ type: 'error', text: response.data.message || 'Failed to update full name' });
      }
    }).catch((error) => {
      setMessage({ type: 'error', text: error?.response?.data?.message || 'Failed to update full name' });
    });
  };

  const handleSendPasswordReset = () => {
    sendPasswordReset(selectedUser.id).then((response) => {
      if (response.data.success) {
        setMessage({ type: 'info', text: response.data.message || 'Password reset email sent' });
      } else {
        setMessage({ type: 'error', text: response.data.message || 'Failed to send password reset' });
      }
    }).catch((error) => {
      setMessage({ type: 'error', text: error?.response?.data?.message || 'Failed to send password reset' });
    });
  };

  const totalPages = Math.ceil(totalCount / filter.length);
  const currentPage = Math.floor(filter.start / filter.length) + 1;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-4">Users</h1>
      <div className="filters tool-bar mb-4">
        <div className="relative w-full max-w-sm">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500 dark:text-gray-400">
            <Icon name="search" />
          </span>
          <input
            name="search"
            type="text"
            placeholder="Search by full name or email"
            value={searchInput}
            onInput={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setFilter((prev) => ({ ...prev, fullName: searchInput, start: 0 }));
              }
            }}
            className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
      </div>
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={filter.length}
        totalItems={totalCount}
        onPageChange={(page) => setFilter((prev) => ({ ...prev, start: (page - 1) * prev.length }))}
      />
      <div className="bg-white dark:bg-gray-800 rounded shadow overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-gray-100 dark:bg-gray-700">
            <tr>
              <th
                className="px-4 py-3 cursor-pointer select-none"
                onClick={() => handleSort('Email')}
              >
                Email {getSortIndicator('Email')}
              </th>
              <th
                className="px-4 py-3 cursor-pointer select-none"
                onClick={() => handleSort('FullName')}
              >
                Full Name {getSortIndicator('FullName')}
              </th>
              <th
                className="px-4 py-3 cursor-pointer select-none"
                onClick={() => handleSort('Created')}
              >
                Created {getSortIndicator('Created')}
              </th>
              <th
                className="px-4 py-3 cursor-pointer select-none"
                onClick={() => handleSort('AR.Name')}
              >
                Role {getSortIndicator('AR.Name')}
              </th>
              <th
                className="px-4 py-3 cursor-pointer select-none"
                onClick={() => handleSort('LastLogin')}
              >
                Last Login {getSortIndicator('LastLogin')}
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((person) => (
              <tr
                key={person.id}
                onClick={() => handleRowClick(person)}
                className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
              >
                <td className="px-4 py-3">{person.email}</td>
                <td className="px-4 py-3">{person.fullName}</td>
                <td className="px-4 py-3">{formatDate(person.created)}</td>
                <td className="px-4 py-3">{person.roleName}</td>
                <td className="px-4 py-3">{formatDate(person.lastLogin)}</td>
              </tr>
            ))}
            {users.length === 0 && !loading && (
              <tr>
                <td colSpan="5" className="px-4 py-6 text-center text-gray-500">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={filter.length}
        totalItems={totalCount}
        onPageChange={(page) => setFilter((prev) => ({ ...prev, start: (page - 1) * prev.length }))}
      />
      {selectedUser && (
        <Modal title="User Details" onClose={handleCloseModal}>
          {message && (
            <Message type={message.type} onClose={() => setMessage(null)}>
              {message.text}
            </Message>
          )}
          <Input
            name="fullName"
            label="Full Name"
            value={fullName}
            onInput={(e) => setFullName(e.target.value)}
          />
          <div className="mb-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">Email</p>
            <p className="font-medium">{selectedUser.email}</p>
          </div>
          <div className="mb-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">Created</p>
            <p>{formatDate(selectedUser.created)}</p>
          </div>
          <div className="mb-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">Last Login</p>
            <p>{formatDate(selectedUser.lastLogin)}</p>
          </div>
          <div className="buttons flex flex-wrap gap-2">
            <Button
              onClick={handleSaveFullName}
              disabled={fullName === selectedUser.fullName}
            >
              Save Changes
            </Button>
            <ButtonOutline onClick={handleSendPasswordReset}>
              Send Password Reset
            </ButtonOutline>
            <Button color="gray" className="cancel" onClick={handleCloseModal}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
