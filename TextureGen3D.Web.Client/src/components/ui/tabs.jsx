import React, { useState } from 'react';

export default function Tabs({ tabs, defaultTab, onTabChange }) {
  const [active, setActive] = useState(defaultTab || tabs[0]?.id);

  const activeTab = tabs.find((tab) => tab.id === active) || tabs[0];

  const handleTabClick = (tabId) => {
    setActive(tabId);
    if (onTabChange) onTabChange(tabId);
  };

  return (
    <div>
      <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4" role="tablist">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => handleTabClick(tab.id)}
            className={`cursor-pointer px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              active === tab.id
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {tab.label}
          </div>
        ))}
      </div>
      <div>{activeTab?.content}</div>
    </div>
  );
}
