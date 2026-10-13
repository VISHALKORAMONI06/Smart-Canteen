import React from 'react';
import { useApp } from '../context/AppContext.jsx';

export default function Header() {
  const {
    role,
    setRole,
    studentView,
    setStudentView,
    staffView,
    setStaffView,
    cartBadge
  } = useApp();

  const handleRoleChange = (newRole) => {
    if (newRole === role) return;
    setRole(newRole);
    if (newRole === 'student') {
      setStudentView('menu');
    } else {
      setStaffView('orders');
    }
  };

  return (
    <header className="app-header">
      <div className="header-container">
        {/* Top bar: Brand & Role Switcher */}
        <div className="header-top">
          <div className="brand-wrapper" onClick={() => (role === 'student' ? setStudentView('menu') : setStaffView('orders'))} role="button" tabIndex={0}>
            <div className="brand-logo" aria-hidden="true">S</div>
            <span className="brand-title">SmartCanteen</span>
          </div>

          {/* Role Switcher Segmented Control */}
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
        </div>

        {/* Role Navigation Bar */}
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
