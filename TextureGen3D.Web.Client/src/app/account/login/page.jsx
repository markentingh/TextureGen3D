import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSession } from '@/context/session';
import { UseAxios } from '@/api/Axios';
import { Auth } from '@/api/account/auth';
import Message from '@/components/ui/message';
import Input from '@/components/forms/input';
import Button from '@/components/ui/button';
import ButtonOutline from '@/components/ui/button-outline';
import ThemeToggle from '@/components/ui/theme-toggle';

export default function Login() {
  const navigate = useNavigate();
  const { login } = useSession();
  const { login: authLogin } = Auth(UseAxios({}));

  const [formData, setFormData] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formState, setFormState] = useState('new');

  const emailRegex = /^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,10}$/;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = {};
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!emailRegex.test(formData.email)) {
      newErrors.email = 'Invalid email';
    }
    if (!formData.password) {
      newErrors.password = 'Password is required';
    }
    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      setFormState('submitting');
      authLogin(formData.email, formData.password).then((response) => {
        if (response.data.success) {
          const data = response.data.data;
          login(data, data.token);
          navigate('/dashboard');
        } else {
          setErrors({ form: response.data.message });
          setFormState('error');
        }
      }).catch(() => {
        setErrors({ form: 'An error occurred during login.' });
        setFormState('error');
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <form onSubmit={handleSubmit} className="w-full max-w-md p-8 bg-white dark:bg-gray-800 rounded shadow">
        <h1 className="text-2xl font-bold mb-6">Sign In</h1>
        {errors.form && (
          <Message type="error" onClose={() => setErrors({ ...errors, form: '' })}>
            {errors.form}
          </Message>
        )}
        <Input
          label="Email"
          type="email"
          name="email"
          value={formData.email}
          onChange={handleChange}
          required={true}
          error={errors.email}
          autoComplete="username"
        />
        <Input
          label="Password"
          labelAction={
            <Link to="/forgot-password" className="text-sm text-primary-600 hover:underline">
              Forgot Password?
            </Link>
          }
          type="password"
          name="password"
          value={formData.password}
          onChange={handleChange}
          required={true}
          error={errors.password}
          autoComplete="current-password"
        />
        <Button type="submit" className="w-full" disabled={formState === 'submitting'}>
          {formState === 'submitting' ? 'Signing in...' : 'Sign In'}
        </Button>
        <div className="mt-6 flex items-center">
          <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
          <span className="mx-4 text-sm text-gray-500 dark:text-gray-400">Or...</span>
          <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
        </div>
        <ButtonOutline to="/signup" className="mt-4 w-full">
          Sign Up
        </ButtonOutline>

        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <ThemeToggle />
        </div>
      </form>
    </div>
  );
}
