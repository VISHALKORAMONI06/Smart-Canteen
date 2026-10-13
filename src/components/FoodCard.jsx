import React from 'react';
import FoodImage from './FoodImage.jsx';
import { useApp } from '../context/AppContext.jsx';

export default function FoodCard({ item }) {
  const { cart, addToCart, updateCartQuantity } = useApp();

  const cartRow = cart.find((c) => c.itemId === item.id);
  const quantityInCart = cartRow ? cartRow.quantity : 0;
  const isAvailable = Boolean(item.available);

  return (
    <article className={`food-card ${!isAvailable ? 'food-card-unavailable' : ''}`}>
      <div className="food-card-media">
        <FoodImage
          src={item.imageUrl}
          alt={item.name}
          name={item.name}
          className="food-card-img"
        />
        <span className="card-category-badge">{item.category}</span>
        {!isAvailable && <span className="card-soldout-badge">SOLD OUT</span>}
      </div>

      <div className="food-card-body">
        <div className="food-card-title-row">
          <h3 className="food-card-title">{item.name}</h3>
          <span className="food-card-price">
            ₹{item.price.toLocaleString('en-IN')}
          </span>
        </div>

        <p className="food-card-desc">{item.description}</p>

        <div className="food-card-footer">
          <div className="food-card-meta">
            <svg
              className="meta-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span className="meta-text">{item.prepTime} min</span>
          </div>

          <div className="food-card-action">
            {!isAvailable ? (
              <button
                type="button"
                className="btn btn-add-disabled"
                disabled
                aria-label={`${item.name} is unavailable`}
              >
                Unavailable
              </button>
            ) : quantityInCart === 0 ? (
              <button
                type="button"
                className="btn btn-add-item"
                onClick={() => addToCart(item.id)}
                aria-label={`Add ${item.name} to order`}
              >
                Add +
              </button>
            ) : (
              <div className="qty-stepper" role="group" aria-label={`Quantity of ${item.name}`}>
                <button
                  type="button"
                  className="qty-btn"
                  onClick={() => updateCartQuantity(item.id, -1)}
                  aria-label={`Decrease quantity of ${item.name}`}
                >
                  −
                </button>
                <span className="qty-value" aria-live="polite">
                  {quantityInCart}
                </span>
                <button
                  type="button"
                  className="qty-btn"
                  onClick={() => updateCartQuantity(item.id, 1)}
                  aria-label={`Increase quantity of ${item.name}`}
                >
                  +
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
