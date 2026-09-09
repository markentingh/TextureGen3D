import React from 'react';
import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <h1 className="text-4xl font-bold mb-4">TextureGen3D</h1>
      <p className="text-lg mb-8">A template web application.</p>
      <Link
        to="/dashboard"
        className="px-6 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition"
      >
        Go to Dashboard
      </Link>
    </div>
  );
}
