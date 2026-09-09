import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { UseAxios } from '@/api/Axios';
import { Auth } from '@/api/account/auth';
import Input from '@/components/forms/input';
import Button from '@/components/ui/button';
import Message from '@/components/ui/message';
import Spinner from '@/components/ui/spinner';
import ThemeToggle from '@/components/ui/theme-toggle';

export default function CreatePassword() {
  const { hash } = useParams();
  const navigate = useNavigate();
  const { checkPasswordReset, updatePassword } = Auth(UseAxios({}));

  const [formData, setFormData] = useState({ password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [formState, setFormState] = useState('checking');

  useEffect(() => {
    checkPasswordReset(hash).then((response) => {
      if (response.data.success) {
        setFormState('new');
      } else {
        setErrors({ form: response.data.message });
        setFormState('error');
      }
    }).catch(() => {
      setErrors({ form: 'The reset link is invalid or has expired.' });
      setFormState('error');
    });
  }, [hash]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = {};
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else {
      if (formData.password.length < 8) newErrors.password = 'Password must be at least 8 characters';
      if (!/[A-Z]/.test(formData.password)) newErrors.password = 'Password must contain at least one uppercase letter';
      if (!/[0-9]/.test(formData.password)) newErrors.password = 'Password must contain at least one number';
    }
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      setFormState('submitting');
      updatePassword(hash, formData.password).then((response) => {
        if (response.data.success) {
          setFormState('success');
        } else {
          setErrors({ form: response.data.message });
          setFormState('error');
        }
      }).catch(() => {
        setErrors({ form: 'An error occurred while updating your password.' });
        setFormState('error');
      });
    }
  };

  if (formState === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <div className="w-full max-w-md p-8 bg-white dark:bg-gray-800 rounded shadow text-center">
          <Spinner className="text-2xl" />
          <p className="mt-4 text-gray-600 dark:text-gray-300">Verifying your reset link...</p>
        </div>
      </div>
    );
  }

  if (formState === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <div className="w-full max-w-md p-8 bg-white dark:bg-gray-800 rounded shadow text-center">
          <h1 className="text-2xl font-bold mb-4">Password Updated</h1>
          <p className="text-gray-600 dark:text-gray-300 mb-6">
            Your password has been reset successfully. You can now sign in with your new password.
          </p>
          <Link
            to="/login"
            className="inline-block py-2 px-6 bg-primary-600 text-white rounded hover:bg-primary-700 transition"
          >
            Go to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <form onSubmit={handleSubmit} className="w-full max-w-md p-8 bg-white dark:bg-gray-800 rounded shadow">
        <h1 className="text-2xl font-bold mb-2">Create New Password</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Enter a new password below.
        </p>

        {errors.form && (
          <Message type="error" onClose={() => setErrors({ ...errors, form: '' })}>
            {errors.form}
          </Message>
        )}

        <Input
          label="New Password"
          type="password"
          name="password"
          value={formData.password}
          onChange={handleChange}
          required={true}
          error={errors.password}
        />
        <Input
          label="Confirm New Password"
          type="password"
          name="confirmPassword"
          value={formData.confirmPassword}
          onChange={handleChange}
          required={true}
          error={errors.confirmPassword}
        />

        {formState === 'submitting' ? (
          <div className="w-full py-2 px-4 flex justify-center">
            <Spinner />
          </div>
        ) : (
          <Button type="submit" className="w-full">
            Update Password
          </Button>
        )}

        <p className="mt-4 text-center text-sm">
          <Link to="/login" className="text-primary-600 hover:underline">
            Back to Sign In
          </Link>
        </p>

        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <ThemeToggle />
        </div>
      </form>
    </div>
  );
}
