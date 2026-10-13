import React, { useState, useMemo } from 'react';
import FoodImage from './FoodImage.jsx';
import { useApp } from '../context/AppContext.jsx';
import { CATEGORIES } from '../utils/seedMenu.js';

export default function MenuManagement() {
  const {
    menu,
    addMenuItem,
    updateMenuItem,
    toggleItemAvailability,
    deleteMenuItem,
    setConfirmDialog
  } = useApp();

  const [modalMode, setModalMode] = useState(null); // 'add' | 'edit' | null
  const [editingItem, setEditingItem] = useState(null);
  const [filterCategory, setFilterCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    category: 'Breakfast',
    price: '',
    prepTime: '',
    description: '',
    imageUrl: '',
    available: true
  });

  const [formErrors, setFormErrors] = useState({});

  // Filtered menu
  const filteredMenu = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return menu.filter((item) => {
      const matchCat = filterCategory === 'All' || item.category === filterCategory;
      const matchQ = !q || item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
      return matchCat && matchQ;
    });
  }, [menu, filterCategory, searchQuery]);

  // Group filtered items by category
  const groupedMenu = useMemo(() => {
    const groups = {};
    for (const item of filteredMenu) {
      if (!groups[item.category]) {
        groups[item.category] = [];
      }
      groups[item.category].push(item);
    }
    return groups;
  }, [filteredMenu]);

  const openAddModal = () => {
    setFormData({
      name: '',
      category: 'Breakfast',
      price: '',
      prepTime: '10',
      description: '',
      imageUrl: '',
      available: true
    });
    setFormErrors({});
    setEditingItem(null);
    setModalMode('add');
  };

  const openEditModal = (item) => {
    setFormData({
      name: item.name,
      category: item.category,
      price: String(item.price),
      prepTime: String(item.prepTime),
      description: item.description,
      imageUrl: item.imageUrl || '',
      available: item.available
    });
    setFormErrors({});
    setEditingItem(item);
    setModalMode('edit');
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingItem(null);
    setFormErrors({});
  };

  // Form Validation
  const validateForm = () => {
    const errors = {};
    const trimmedName = formData.name.trim();

    // 1. Name validation (2-40 chars, no duplicates)
    if (!trimmedName) {
      errors.name = 'Item name is required.';
    } else if (trimmedName.length < 2 || trimmedName.length > 40) {
      errors.name = 'Name must be between 2 and 40 characters.';
    } else {
      // Check duplicate
      const isDuplicate = menu.some((item) => {
        if (editingItem && item.id === editingItem.id) return false;
        return item.name.trim().toLowerCase() === trimmedName.toLowerCase();
      });
      if (isDuplicate) {
        errors.name = 'A dish with this name already exists in the menu.';
      }
    }

    // 2. Price validation (number > 0 and <= 5000)
    const numPrice = Number(formData.price);
    if (!formData.price || isNaN(numPrice)) {
      errors.price = 'Please enter a valid numeric price.';
    } else if (numPrice <= 0) {
      errors.price = 'Price must be greater than ₹0.';
    } else if (numPrice > 5000) {
      errors.price = 'Price cannot exceed ₹5,000.';
    } else if (!Number.isInteger(numPrice)) {
      errors.price = 'Price must be a whole rupee integer.';
    }

    // 3. Category
    if (!formData.category || !CATEGORIES.includes(formData.category) || formData.category === 'All') {
      errors.category = 'Please select a valid menu category.';
    }

    // 4. Prep Time (1-120 mins)
    const numPrep = Number(formData.prepTime);
    if (!formData.prepTime || isNaN(numPrep)) {
      errors.prepTime = 'Please enter preparation time in minutes.';
    } else if (numPrep < 1 || numPrep > 120) {
      errors.prepTime = 'Prep time must be between 1 and 120 minutes.';
    }

    // 5. Description (max 120 chars)
    if (formData.description && formData.description.length > 120) {
      errors.description = 'Description cannot exceed 120 characters.';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    const itemPayload = {
      name: formData.name.trim(),
      category: formData.category,
      price: parseInt(formData.price, 10),
      prepTime: parseInt(formData.prepTime, 10),
      description: formData.description.trim(),
      imageUrl: formData.imageUrl.trim(),
      available: Boolean(formData.available)
    };

    if (modalMode === 'add') {
      addMenuItem(itemPayload);
    } else if (modalMode === 'edit' && editingItem) {
      updateMenuItem({ ...itemPayload, id: editingItem.id });
    }

    closeModal();
  };

  const handleDeleteClick = (item) => {
    setConfirmDialog({
      title: 'Delete Menu Item',
      message: `Are you sure you want to delete "${item.name}" from the menu?`,
      details: (
        <p className="confirm-note">
          Note: Existing past or active orders that contain this dish will preserve their history and prices unaffected.
        </p>
      ),
      confirmText: 'Delete Dish',
      cancelText: 'Cancel',
      isDestructive: true,
      onConfirm: () => deleteMenuItem(item.id)
    });
  };

  return (
    <div className="page-content menu-management-page">
      <section className="menu-mgmt-header">
        <div>
          <span className="eyebrow-tag">CANTEEN CATALOG</span>
          <h1 className="hero-title">Menu Management</h1>
          <p className="hero-subtitle">
            Configure dishes, adjust pricing, and toggle live counter availability.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={openAddModal}
          aria-label="Add new dish to menu"
        >
          + Add New Item
        </button>
      </section>

      {/* Filter and Search Bar */}
      <section className="menu-mgmt-filters">
        <div className="search-box-wrapper">
          <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            className="menu-search-input"
            placeholder="Search items to edit or toggle..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search dishes"
          />
        </div>

        <div className="category-chips-list">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`category-chip ${filterCategory === cat ? 'active' : ''}`}
              onClick={() => setFilterCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </section>

      {/* Grouped Menu Table */}
      <section className="menu-mgmt-content" aria-label="Menu list">
        {filteredMenu.length === 0 ? (
          <div className="empty-state-box">
            <div className="empty-state-icon">📋</div>
            <h2 className="empty-state-title">No menu items found</h2>
            <p className="empty-state-text">Try clearing your search query or add a new item.</p>
          </div>
        ) : (
          Object.entries(groupedMenu).map(([category, items]) => (
            <div key={category} className="mgmt-category-group">
              <h2 className="mgmt-group-title">{category} ({items.length})</h2>

              <div className="table-responsive">
                <table className="canteen-table mgmt-table">
                  <thead>
                    <tr>
                      <th style={{ width: '60px' }}>Dish</th>
                      <th>Details</th>
                      <th>Category</th>
                      <th>Price</th>
                      <th>Prep</th>
                      <th>Available</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id} className={!item.available ? 'tr-unavailable' : ''}>
                        <td className="mgmt-thumb-cell">
                          <FoodImage
                            src={item.imageUrl}
                            alt={item.name}
                            name={item.name}
                            className="mgmt-thumb"
                          />
                        </td>
                        <td className="mgmt-info-cell">
                          <div className="mgmt-item-name">{item.name}</div>
                          <div className="mgmt-item-desc">{item.description}</div>
                        </td>
                        <td>
                          <span className="mgmt-cat-tag">{item.category}</span>
                        </td>
                        <td className="mgmt-price-cell">
                          ₹{item.price.toLocaleString('en-IN')}
                        </td>
                        <td>{item.prepTime} min</td>
                        <td>
                          {/* Accessible Toggle Switch */}
                          <label className="toggle-switch" aria-label={`Toggle availability for ${item.name}`}>
                            <input
                              type="checkbox"
                              checked={item.available}
                              onChange={() => toggleItemAvailability(item.id)}
                            />
                            <span className="slider-track" />
                            <span className="toggle-label-text">
                              {item.available ? 'Available' : 'Sold Out'}
                            </span>
                          </label>
                        </td>
                        <td className="text-right mgmt-actions-cell">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            onClick={() => openEditModal(item)}
                            aria-label={`Edit ${item.name}`}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline text-danger"
                            onClick={() => handleDeleteClick(item)}
                            aria-label={`Delete ${item.name}`}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </section>

      {/* Add / Edit Modal */}
      {modalMode && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="mgmt-modal-title">
          <div className="modal-dialog">
            <div className="modal-header">
              <h2 id="mgmt-modal-title" className="modal-title">
                {modalMode === 'add' ? 'Add New Menu Item' : `Edit "${editingItem?.name}"`}
              </h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={closeModal}
                aria-label="Close form"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleFormSubmit} noValidate>
              <div className="modal-body form-grid">
                {/* Name */}
                <div className="form-group">
                  <label htmlFor="item-name" className="input-label">
                    Dish Name <span className="text-danger">*</span>
                  </label>
                  <input
                    id="item-name"
                    type="text"
                    className={`input-field ${formErrors.name ? 'input-error' : ''}`}
                    placeholder="e.g. Masala Dosa"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                  {formErrors.name && <span className="field-error-msg">{formErrors.name}</span>}
                </div>

                {/* Category & Price in one row */}
                <div className="form-row-2">
                  <div className="form-group">
                    <label htmlFor="item-category" className="input-label">
                      Category <span className="text-danger">*</span>
                    </label>
                    <select
                      id="item-category"
                      className={`input-field ${formErrors.category ? 'input-error' : ''}`}
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    >
                      {CATEGORIES.filter((c) => c !== 'All').map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                    {formErrors.category && <span className="field-error-msg">{formErrors.category}</span>}
                  </div>

                  <div className="form-group">
                    <label htmlFor="item-price" className="input-label">
                      Price (₹) <span className="text-danger">*</span>
                    </label>
                    <input
                      id="item-price"
                      type="number"
                      min="1"
                      max="5000"
                      className={`input-field ${formErrors.price ? 'input-error' : ''}`}
                      placeholder="e.g. 60"
                      value={formData.price}
                      onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                    />
                    {formErrors.price && <span className="field-error-msg">{formErrors.price}</span>}
                  </div>
                </div>

                {/* Prep Time & Availability */}
                <div className="form-row-2">
                  <div className="form-group">
                    <label htmlFor="item-preptime" className="input-label">
                      Prep Time (min) <span className="text-danger">*</span>
                    </label>
                    <input
                      id="item-preptime"
                      type="number"
                      min="1"
                      max="120"
                      className={`input-field ${formErrors.prepTime ? 'input-error' : ''}`}
                      placeholder="e.g. 10"
                      value={formData.prepTime}
                      onChange={(e) => setFormData({ ...formData, prepTime: e.target.value })}
                    />
                    {formErrors.prepTime && <span className="field-error-msg">{formErrors.prepTime}</span>}
                  </div>

                  <div className="form-group toggle-group-inline">
                    <label className="input-label">Initial Availability</label>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={formData.available}
                        onChange={(e) => setFormData({ ...formData, available: e.target.checked })}
                      />
                      <span className="slider-track" />
                      <span className="toggle-label-text">
                        {formData.available ? 'Available' : 'Sold Out'}
                      </span>
                    </label>
                  </div>
                </div>

                {/* Image URL */}
                <div className="form-group">
                  <label htmlFor="item-image" className="input-label">
                    Image URL (Optional)
                  </label>
                  <input
                    id="item-image"
                    type="url"
                    className="input-field"
                    placeholder="https://images.unsplash.com/..."
                    value={formData.imageUrl}
                    onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                  />
                  <span className="field-hint">
                    Leave blank or enter broken URL to test styled letter fallback.
                  </span>
                </div>

                {/* Description */}
                <div className="form-group">
                  <label htmlFor="item-desc" className="input-label">
                    Description (Max 120 chars)
                  </label>
                  <textarea
                    id="item-desc"
                    rows="2"
                    maxLength={120}
                    className={`input-field ${formErrors.description ? 'input-error' : ''}`}
                    placeholder="Short description of ingredients or taste..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                  <div className="desc-char-counter">
                    {formData.description.length} / 120 chars
                  </div>
                  {formErrors.description && <span className="field-error-msg">{formErrors.description}</span>}
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={closeModal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  {modalMode === 'add' ? 'Add Dish' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
