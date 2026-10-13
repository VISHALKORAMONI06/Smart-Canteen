import React, { useState } from 'react';

/**
 * Image component with 4:3 aspect ratio and graceful fallback on network error or missing URL.
 * Fallback renders a tinted block with the item's first initial in serif font.
 */
export default function FoodImage({ src, alt = '', className = '', name = '' }) {
  const [hasError, setHasError] = useState(false);

  const initial = name ? name.trim().charAt(0).toUpperCase() : '🍽️';

  if (!src || hasError) {
    return (
      <div
        className={`food-image-fallback ${className}`}
        aria-label={alt || name}
        role="img"
      >
        <span className="fallback-initial">{initial}</span>
        <span className="fallback-tag">{name ? name.slice(0, 14) : 'Canteen'}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt || name}
      className={`food-image ${className}`}
      loading="lazy"
      onError={() => setHasError(true)}
    />
  );
}
