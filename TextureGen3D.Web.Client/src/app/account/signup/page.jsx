import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '@/context/session';
import { UseAxios } from '@/api/Axios';
import { Users } from '@/api/account/users';
import { Auth } from '@/api/account/auth';
import Message from '@/components/ui/message';
import Icon from '@/components/ui/icon';
import Input from '@/components/forms/input';
import ButtonOutline from '@/components/ui/button-outline';
import Button from '@/components/ui/button';
import Spinner from '@/components/ui/spinner';
import ThemeToggle from '@/components/ui/theme-toggle';

export default function SignUp() {
  const navigate = useNavigate();
  const { login } = useSession();
  const { register } = Users(useSession());
  const { login: authLogin } = Auth(UseAxios({}));

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [errors, setErrors] = useState({});
  const [passwordWarning, setPasswordWarning] = useState('');
  const [formState, setFormState] = useState('new');

  const emailRegex = /^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,10}$/;

  const getPasswordStrengthError = (password) => {
    if (password.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
    if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
    return '';
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    const updated = { ...formData, [name]: value };
    setFormData(updated);

    if (name === 'password' || name === 'confirmPassword') {
      setPasswordWarning(getPasswordStrengthError(updated.password));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = {};

    if (!formData.firstName) newErrors.firstName = 'First name is required';
    if (!formData.lastName) newErrors.lastName = 'Last name is required';
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!emailRegex.test(formData.email)) {
      newErrors.email = 'Invalid email';
    }
    const passwordStrengthError = getPasswordStrengthError(formData.password);
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (passwordStrengthError) {
      newErrors.password = passwordStrengthError;
    }
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      setFormState('submitting');
      register({
        FullName: `${formData.firstName} ${formData.lastName}`,
        Email: formData.email,
        Password: formData.password
      }).then((response) => {
        if (response.data.success) {
          if (response.data.data?.isFirstUser) {
            authLogin(formData.email, formData.password).then((loginResponse) => {
              if (loginResponse.data.success) {
                const data = loginResponse.data.data;
                login(data, data.token);
                navigate('/dashboard');
              } else {
                setFormState('success');
              }
            }).catch(() => {
              setFormState('success');
            });
          } else {
            setFormState('success');
          }
        } else {
          setErrors({ form: response.data.message });
          setFormState('error');
        }
      }).catch(() => {
        setErrors({ form: 'An error occurred during registration.' });
        setFormState('error');
      });
    }
  };

  if (formState === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <div className="w-full max-w-md p-8 bg-white dark:bg-gray-800 rounded shadow text-center">
          <div className="mb-4 flex justify-center">
            <div className="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-600 dark:text-primary-400">
              <Icon name="mail" className="text-3xl" />
            </div>
          </div>
          <h1 className="text-2xl font-bold mb-4">Account Created</h1>
          <p className="text-gray-600 dark:text-gray-300 mb-4">
            An activation email has been sent to your inbox. Please follow the instructions in the email to activate your account.
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            If you don't see the email within a few minutes, please check your spam or junk folder.
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
        <h1 className="text-2xl font-bold mb-2">Sign Up</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Create a new account</p>

        {errors.form && (
          <Message type="error" onClose={() => setErrors({ ...errors, form: '' })}>
            {errors.form}
          </Message>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="First Name"
            type="text"
            name="firstName"
            value={formData.firstName}
            onChange={handleChange}
            required={true}
            error={errors.firstName}
          />
          <Input
            label="Last Name"
            type="text"
            name="lastName"
            value={formData.lastName}
            onChange={handleChange}
            required={true}
            error={errors.lastName}
          />
        </div>

        <Input
          label="Email"
          type="email"
          name="email"
          value={formData.email}
          onChange={handleChange}
          required={true}
          error={errors.email}
        />
        <Input
          label="Password"
          type="password"
          name="password"
          value={formData.password}
          onChange={handleChange}
          required={true}
          error={errors.password}
        />
        <Input
          label="Confirm Password"
          type="password"
          name="confirmPassword"
          value={formData.confirmPassword}
          onChange={handleChange}
          required={true}
          error={errors.confirmPassword}
        />
        {passwordWarning && (
          <p className="text-yellow-600 text-sm mb-4">{passwordWarning}</p>
        )}

        {formState === 'submitting' ? (
          <div className="w-full py-2 px-4 flex justify-center">
            <Spinner />
          </div>
        ) : (
          <Button type="submit" className="w-full">
            Create Account
          </Button>
        )}

        <div className="mt-6 flex items-center">
          <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
          <span className="mx-4 text-sm text-gray-500 dark:text-gray-400">Or...</span>
          <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
        </div>

        <ButtonOutline to="/login" className="mt-4 w-full">
          Sign In
        </ButtonOutline>

        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <ThemeToggle />
        </div>
      </form>
    </div>
  );
}
