import React, { useState, useMemo } from 'react';
import FoodCard from './FoodCard.jsx';
import { CATEGORIES } from '../utils/seedMenu.js';
import { useApp } from '../context/AppContext.jsx';

export default function StudentMenu() {
  const { menu } = useApp();
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Calculate live count per category based on active menu
  const categoryCounts = useMemo(() => {
    const counts = { All: menu.length };
    for (const item of menu) {
      counts[item.category] = (counts[item.category] || 0) + 1;
    }
    return counts;
  }, [menu]);

  // Combined search and category filtering
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return menu.filter((item) => {
      const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
      const matchesSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [menu, selectedCategory, searchQuery]);

  const handleClearFilters = () => {
    setSelectedCategory('All');
    setSearchQuery('');
  };

  return (
    <div className="page-content student-menu-page">
      {/* Editorial Hero Header */}
      <section className="menu-hero">
        <span className="eyebrow-tag">TODAY&apos;S MENU</span>
        <h1 className="hero-title">
          Skip the queue. <span className="hero-accent">Pre-order</span> your meal.
        </h1>
        <p className="hero-subtitle">
          Order ahead, get an instant pickup token, and collect at the counter when it&apos;s hot and ready.
        </p>
      </section>

      {/* Search & Category Filter Section */}
      <section className="menu-controls-section" aria-label="Menu Filters">
        <div className="search-box-wrapper">
          <svg
            className="search-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            className="menu-search-input"
            placeholder="Search dosas, thali, coffee, snacks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search menu items"
          />
          {searchQuery && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search query"
            >
              ×
            </button>
          )}
        </div>

        {/* Category Filter Chips */}
        <div className="category-chips-list" role="tablist" aria-label="Categories">
          {CATEGORIES.map((cat) => {
            const count = categoryCounts[cat] || 0;
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={isSelected}
                className={`category-chip ${isSelected ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                <span className="chip-label">{cat}</span>
                <span className="chip-count">{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Grid of Dishes or Empty State */}
      <section className="menu-grid-section" aria-label="Dishes">
        {filteredItems.length === 0 ? (
          <div className="empty-state-box">
            <div className="empty-state-icon" aria-hidden="true">🍲</div>
            <h2 className="empty-state-title">No dishes match your filter</h2>
            <p className="empty-state-text">
              Try adjusting your search terms or picking another category.
            </p>
            <button
              type="button"
              className="btn btn-outline"
              onClick={handleClearFilters}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="food-grid">
            {filteredItems.map((item) => (
              <FoodCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
