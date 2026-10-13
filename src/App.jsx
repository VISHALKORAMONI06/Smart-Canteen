import React from 'react';
import { AppProvider, useApp } from './context/AppContext.jsx';
import Header from './components/Header.jsx';
import StudentMenu from './components/StudentMenu.jsx';
import Cart from './components/Cart.jsx';
import OrdersPage from './components/OrdersPage.jsx';
import StaffOrders from './components/StaffOrders.jsx';
import DemandDashboard from './components/DemandDashboard.jsx';
import MenuManagement from './components/MenuManagement.jsx';
import ToastContainer from './components/Toast.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import Footer from './components/Footer.jsx';
import './App.css';

function MainContent() {
  const { role, studentView, staffView } = useApp();

  return (
    <main className="main-viewport" id="main-content">
      {role === 'student' && (
        <>
          {studentView === 'menu' && <StudentMenu />}
          {studentView === 'cart' && <Cart />}
          {studentView === 'orders' && <OrdersPage />}
        </>
      )}

      {role === 'staff' && (
        <>
          {staffView === 'orders' && <StaffOrders />}
          {staffView === 'demand' && <DemandDashboard />}
          {staffView === 'menu' && <MenuManagement />}
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
