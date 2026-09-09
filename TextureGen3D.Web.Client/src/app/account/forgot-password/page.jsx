import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { UseAxios } from '@/api/Axios';
import { Users } from '@/api/account/users';
import Input from '@/components/forms/input';
import Button from '@/components/ui/button';
import Message from '@/components/ui/message';
import Spinner from '@/components/ui/spinner';
import ThemeToggle from '@/components/ui/theme-toggle';

export default function ForgotPassword() {
  const { forgotPassword } = Users(UseAxios({}));

  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState({});
  const [formState, setFormState] = useState('new');

  const emailRegex = /^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,10}$/;

  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = {};
    if (!email) {
      newErrors.email = 'Email is required';
    } else if (!emailRegex.test(email)) {
      newErrors.email = 'Invalid email';
    }
    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      setFormState('submitting');
      forgotPassword(email).then((response) => {
        if (response.data.success) {
          setFormState('success');
        } else {
          setErrors({ form: response.data.message });
          setFormState('error');
        }
      }).catch(() => {
        setErrors({ form: 'An error occurred while requesting a password reset.' });
        setFormState('error');
      });
    }
  };

  if (formState === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <div className="w-full max-w-md p-8 bg-white dark:bg-gray-800 rounded shadow text-center">
          <h1 className="text-2xl font-bold mb-4">Check Your Email</h1>
          <p className="text-gray-600 dark:text-gray-300 mb-6">
            If an account exists for this email address, a password reset link has been sent. Please check your inbox and spam folder.
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
        <h1 className="text-2xl font-bold mb-2">Reset Password</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Enter your email address and we'll send you a link to reset your password.
        </p>

        {errors.form && (
          <Message type="error" onClose={() => setErrors({ ...errors, form: '' })}>
            {errors.form}
          </Message>
        )}

        <Input
          label="Email"
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required={true}
          error={errors.email}
        />

        {formState === 'submitting' ? (
          <div className="w-full py-2 px-4 flex justify-center">
            <Spinner />
          </div>
        ) : (
          <Button type="submit" className="w-full">
            Send Reset Link
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
