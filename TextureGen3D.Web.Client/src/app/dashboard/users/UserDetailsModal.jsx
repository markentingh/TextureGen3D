import React, { useState, useEffect } from 'react';
import { useSession } from '@/context/session';
import { Users } from '@/api/admin/users';
import Modal from '@/components/ui/modal';
import Input from '@/components/forms/input';
import ButtonOutline from '@/components/ui/button-outline';
import Button from '@/components/ui/button';
import Message from '@/components/ui/message';

const formatDate = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  return date.toLocaleString();
};

export default function UserDetailsModal({ userId, user, onClose }) {
  const session = useSession();
  const { getById, updateFullName, sendPasswordReset } = Users(session);

  const [userData, setUserData] = useState(user || null);
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(!user);

  useEffect(() => {
    if (user) {
      setUserData(user);
      setFullName(user.fullName || '');
      setLoading(false);
    } else if (userId) {
      setLoading(true);
      getById(userId).then((response) => {
        setLoading(false);
        if (response.data.success) {
          setUserData(response.data.data);
          setFullName(response.data.data.fullName || '');
        }
      }).catch(() => setLoading(false));
    }
  }, [userId, user]);

  if (loading) return null;
  if (!userData) return null;

  const handleSaveFullName = () => {
    updateFullName({ Id: userData.id, FullName: fullName }).then((response) => {
      if (response.data.success) {
        setMessage({ type: 'info', text: 'Full name updated' });
        setUserData((prev) => ({ ...prev, fullName }));
      } else {
        setMessage({ type: 'error', text: response.data.message || 'Failed to update full name' });
      }
    }).catch((error) => {
      setMessage({ type: 'error', text: error?.response?.data?.message || 'Failed to update full name' });
    });
  };

  const handleSendPasswordReset = () => {
    sendPasswordReset(userData.id).then((response) => {
      if (response.data.success) {
        setMessage({ type: 'info', text: response.data.message || 'Password reset email sent' });
      } else {
        setMessage({ type: 'error', text: response.data.message || 'Failed to send password reset' });
      }
    }).catch((error) => {
      setMessage({ type: 'error', text: error?.response?.data?.message || 'Failed to send password reset' });
    });
  };

  return (
    <Modal title="User Details" onClose={onClose}>
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
        <p className="font-medium">{userData.email}</p>
      </div>
      <div className="mb-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">Created</p>
        <p>{formatDate(userData.created)}</p>
      </div>
      <div className="mb-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">Last Login</p>
        <p>{formatDate(userData.lastLogin)}</p>
      </div>
      <div className="buttons flex flex-wrap gap-2">
        <Button onClick={handleSaveFullName} disabled={fullName === userData.fullName}>
          Save Changes
        </Button>
        <ButtonOutline onClick={handleSendPasswordReset}>
          Send Password Reset
        </ButtonOutline>
        <Button color="gray" className="cancel" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
