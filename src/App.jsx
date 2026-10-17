import React from 'react';
import { AppProvider, useApp } from './context/AppContext.jsx';
import Header from './components/Header.jsx';
import StudentMenu from './components/StudentMenu.jsx';
import Cart from './components/Cart.jsx';
import OrdersPage from './components/OrdersPage.jsx';
import StaffOrders from './components/StaffOrders.jsx';
import DemandDashboard from './components/DemandDashboard.jsx';
import AnalyticsDashboard from './components/AnalyticsDashboard.jsx';
import MenuManagement from './components/MenuManagement.jsx';
import AuthPage from './components/AuthPage.jsx';
import ToastContainer from './components/Toast.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import Footer from './components/Footer.jsx';
import './App.css';
import { isSupabaseConfigured } from './lib/supabaseClient.js';

function MainContent() {
  const {
    role, studentView, staffView,
    isAuthenticated, authLoading,
    signIn, signUp, authError, setAuthError,
    isAdmin, settings, addToast
  } = useApp();

  // Show loading spinner while auth is initializing
  if (authLoading) {
    return (
      <main className="main-viewport" id="main-content">
        <div className="loading-state-center">
          <div className="spinner" role="status" aria-label="Loading…" />
          <p className="loading-hint">Loading SmartCanteen…</p>
        </div>
      </main>
    );
  }

  // When Supabase is configured and user is not authenticated, show auth page
  if (isSupabaseConfigured && !isAuthenticated) {
    return (
      <main className="main-viewport" id="main-content">
        <AuthPage
          onSignIn={signIn}
          onSignUp={signUp}
          authError={authError}
          setAuthError={setAuthError}
        />
      </main>
    );
  }

  // Canteen closed banner for students trying to order
  const isCanteenClosed = !settings?.orderingOpen;

  return (
    <main className="main-viewport" id="main-content">
      {/* Canteen closed notice */}
      {isCanteenClosed && role === 'student' && studentView === 'menu' && (
        <div className="alert-banner alert-warning canteen-closed-banner" role="alert">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>
            <strong>Canteen is currently closed.</strong> Orders are not being accepted at this time.
          </span>
        </div>
      )}

      {role === 'student' && (
        <>
          {studentView === 'menu'   && <StudentMenu />}
          {studentView === 'cart'   && <Cart />}
          {studentView === 'orders' && <OrdersPage />}
        </>
      )}

      {(role === 'staff' || role === 'admin') && (
        <>
          {staffView === 'orders'    && <StaffOrders />}
          {staffView === 'demand'    && <DemandDashboard />}
          {staffView === 'analytics' && <AnalyticsDashboard />}
          {staffView === 'menu'      && <MenuManagement />}
        </>
      )}
    </main>
  );
}

export default function App() {
  return (
    <AppProvider>
      <div className="app-root">
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <Header />
        <MainContent />
        <Footer />
        <ToastContainer />
        <ConfirmDialog />
      </div>
    </AppProvider>
  );
}
