import React from 'react';
import Spinner from '@/components/ui/spinner';

export default function LoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Spinner className="text-4xl" />
    </div>
  );
}
