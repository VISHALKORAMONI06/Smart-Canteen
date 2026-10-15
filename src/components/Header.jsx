import React, { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { isSupabaseConfigured } from '../lib/supabaseClient.js';

export default function Header() {
  const {
    role,
    setRole,
    setDemoRole,
    studentView,
    setStudentView,
    staffView,
    setStaffView,
    cartBadge,
    isAuthenticated,
    isAdmin,
    profile,
    user,
    signOut,
    isDemoMode,
    settings
  } = useApp();

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  const handleRoleChange = (newRole) => {
    if (newRole === role) return;
    if (isDemoMode) {
      // Demo mode: freely switch roles
      setDemoRole(newRole);
    }
    // In Supabase mode, role is set by the profile — no switching allowed
    if (newRole === 'student') {
      setStudentView('menu');
    } else {
      setStaffView('orders');
    }
  };

  const handleBrandClick = () => {
    if (role === 'student') {
      setStudentView('menu');
    } else {
      setStaffView('orders');
    }
  };

  const handleSignOut = async () => {
    setIsUserMenuOpen(false);
    await signOut();
  };

  // Display name: prefer profile, fall back to email prefix
  const displayName = profile?.display_name || user?.email?.split('@')[0] || 'User';
  const roleLabel   = role === 'admin' ? 'Admin' : role === 'staff' ? 'Staff' : 'Student';

  return (
    <header className="app-header">
      <div className="header-container">
        {/* Top bar: Brand + Auth/Role controls */}
        <div className="header-top">
          <div
            className="brand-wrapper"
            onClick={handleBrandClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleBrandClick()}
            aria-label="SmartCanteen home"
          >
            <div className="brand-logo" aria-hidden="true">S</div>
            <span className="brand-title">
              SmartCanteen
              {settings?.canteenName && settings.canteenName !== 'SmartCanteen'
                ? ` — ${settings.canteenName}` : ''}
            </span>
          </div>

          {/* Demo mode: role switcher segmented control */}
          {isDemoMode && (
            <div className="role-switcher" role="radiogroup" aria-label="User role">
              <button
                type="button"
                role="radio"
                aria-checked={role === 'student'}
                className={`role-tab ${role === 'student' ? 'active' : ''}`}
                onClick={() => handleRoleChange('student')}
              >
                Student
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={role === 'staff'}
                className={`role-tab ${role === 'staff' ? 'active' : ''}`}
                onClick={() => handleRoleChange('staff')}
              >
                Staff
              </button>
            </div>
          )}

          {/* Supabase mode: user account display */}
          {isSupabaseConfigured && isAuthenticated && (
            <div className="user-account-area">
              <button
                type="button"
                className="user-account-btn"
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                aria-expanded={isUserMenuOpen}
                aria-haspopup="menu"
                aria-label={`Account menu for ${displayName}`}
              >
                <div className="user-avatar" aria-hidden="true">
                  {displayName.charAt(0).toUpperCase()}
                </div>
                <div className="user-info-col">
                  <span className="user-display-name">{displayName}</span>
                  <span className="user-role-badge">{roleLabel}</span>
                </div>
                <svg className="chevron-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {isUserMenuOpen && (
                <>
                  <div
                    className="user-menu-backdrop"
                    onClick={() => setIsUserMenuOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="user-dropdown-menu" role="menu" aria-label="Account options">
                    <div className="user-dropdown-header">
                      <span className="dropdown-name">{displayName}</span>
                      <span className="dropdown-email">{user?.email}</span>
                    </div>
                    <div className="user-dropdown-divider" />
                    <button
                      type="button"
                      role="menuitem"
                      className="user-dropdown-item text-danger"
                      onClick={handleSignOut}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                      Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Navigation bar */}
        <nav className="header-nav" aria-label="Main Navigation">
          {role === 'student' ? (
            <ul className="nav-list">
              <li>
                <button
                  type="button"
                  className={`nav-link ${studentView === 'menu' ? 'active' : ''}`}
                  onClick={() => setStudentView('menu')}
                >
                  Menu
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`nav-link ${studentView === 'cart' ? 'active' : ''}`}
                  onClick={() => setStudentView('cart')}
                >
                  Cart
                  {cartBadge > 0 && <span className="nav-badge">{cartBadge}</span>}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`nav-link ${studentView === 'orders' ? 'active' : ''}`}
                  onClick={() => setStudentView('orders')}
                >
                  My Orders
                </button>
              </li>
            </ul>
          ) : (
            <ul className="nav-list">
              <li>
                <button
                  type="button"
                  className={`nav-link ${staffView === 'orders' ? 'active' : ''}`}
                  onClick={() => setStaffView('orders')}
                >
                  Orders
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`nav-link ${staffView === 'demand' ? 'active' : ''}`}
                  onClick={() => setStaffView('demand')}
                >
                  Demand
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`nav-link ${staffView === 'menu' ? 'active' : ''}`}
                  onClick={() => setStaffView('menu')}
                >
                  Menu
                </button>
              </li>
            </ul>
          )}
        </nav>
      </div>
    </header>
  );
}
