import React from 'react';
import Icon from './icon';

export default function Spinner({ className = '' }) {
  return <Icon name="progress_activity" spin className={className} />;
}
