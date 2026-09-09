import React from 'react';

export function List({ children, className = '', hover = true, inModal = false, bg = true }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          const props = { ...child.props, inModal };
          if (child.props.hover === undefined) props.hover = hover;
          if (child.props.bg === undefined) props.bg = bg;
          return React.cloneElement(child, props);
        }
        return child;
      })}
    </div>
  );
}

export function Item({ children, hover = true, inModal = false, bg = true, className = '', ...rest }) {
  const hoverClass = hover
    ? inModal
      ? 'hover:bg-gray-200 dark:hover:bg-gray-700/70'
      : 'hover:bg-gray-100 dark:hover:bg-gray-700'
    : '';
  const bgClass = bg
    ? inModal
      ? 'bg-gray-100 dark:bg-gray-700/50'
      : 'bg-gray-50 dark:bg-gray-800'
    : '';
  return (
    <div
      {...rest}
      className={`flex items-center rounded-lg ${bgClass} p-3 transition ${hoverClass} ${className}`}
    >
      {children}
    </div>
  );
}

export default List;
