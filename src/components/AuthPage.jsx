/**
 * AuthPage — Sign In / Sign Up UI for SmartCanteen.
 * Used only when Supabase is configured AND user is not authenticated.
 */
import React, { useState } from 'react';

export default function AuthPage({ onSignIn, onSignUp, authError, setAuthError }) {
  const [mode, setMode]             = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading]       = useState(false);
  const [localError, setLocalError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const clearMessages = () => {
    setLocalError('');
    setSuccessMsg('');
    if (setAuthError) setAuthError(null);
  };

  const validate = () => {
    if (!email.trim()) return 'Email is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Please enter a valid email address.';
    if (!password) return 'Password is required.';
    if (password.length < 6) return 'Password must be at least 6 characters.';
    if (mode === 'signup' && displayName.trim().length < 2) return 'Display name must be at least 2 characters.';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearMessages();

    const validationError = validate();
    if (validationError) {
      setLocalError(validationError);
      return;
    }

    setLoading(true);
    try {
      if (mode === 'signin') {
        const { error } = await onSignIn(email.trim(), password);
        if (error) {
          setLocalError(error.message || 'Sign in failed. Please check your credentials.');
        }
      } else {
        const { error, data } = await onSignUp(email.trim(), password, displayName.trim());
        if (error) {
          setLocalError(error.message || 'Sign up failed. Please try again.');
        } else {
          setSuccessMsg(
            data?.user?.identities?.length === 0
              ? 'Email already registered. Please sign in.'
              : 'Account created! Check your email to confirm your address, then sign in.'
          );
          setMode('signin');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    clearMessages();
    setEmail('');
    setPassword('');
    setDisplayName('');
    setMode(mode === 'signin' ? 'signup' : 'signin');
  };

  const displayError = localError || authError || '';

  return (
    <div className="auth-page" role="main" aria-label="Authentication">
      <div className="auth-container">
        {/* Brand */}
        <div className="auth-brand">
          <div className="brand-logo auth-brand-logo" aria-hidden="true">S</div>
          <h1 className="auth-brand-title">SmartCanteen</h1>
          <p className="auth-brand-tagline">Pre-order your meal. Skip the queue.</p>
        </div>

        {/* Card */}
        <div className="auth-card">
          <div className="auth-card-header">
            <h2 className="auth-card-title">
              {mode === 'signin' ? 'Sign in to your account' : 'Create your account'}
            </h2>
          </div>

          {/* Tab switcher */}
          <div className="auth-mode-tabs" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              className={`auth-tab ${mode === 'signin' ? 'active' : ''}`}
              onClick={() => mode !== 'signin' && switchMode()}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
              onClick={() => mode !== 'signup' && switchMode()}
            >
              Sign Up
            </button>
          </div>

          {/* Success message */}
          {successMsg && (
            <div className="alert-banner alert-success" role="status" aria-live="polite">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{successMsg}</span>
            </div>
          )}

          {/* Error message */}
          {displayError && (
            <div className="alert-banner alert-error" role="alert" aria-live="polite">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{displayError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="auth-form">
            {/* Display Name (signup only) */}
            {mode === 'signup' && (
              <div className="form-group">
                <label htmlFor="auth-displayname" className="input-label">
                  Display Name <span className="text-danger" aria-hidden="true">*</span>
                </label>
                <input
                  id="auth-displayname"
                  type="text"
                  className="input-field"
                  placeholder="e.g. Priya Sharma"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="name"
                  maxLength={50}
                  required
                />
              </div>
            )}

            {/* Email */}
            <div className="form-group">
              <label htmlFor="auth-email" className="input-label">
                Email <span className="text-danger" aria-hidden="true">*</span>
              </label>
              <input
                id="auth-email"
                type="email"
                className="input-field"
                placeholder="you@college.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete={mode === 'signup' ? 'email' : 'username'}
                required
              />
            </div>

            {/* Password */}
            <div className="form-group">
              <label htmlFor="auth-password" className="input-label">
                Password <span className="text-danger" aria-hidden="true">*</span>
              </label>
              <input
                id="auth-password"
                type="password"
                className="input-field"
                placeholder={mode === 'signup' ? 'Minimum 6 characters' : '••••••••'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minLength={6}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block auth-submit-btn"
              disabled={loading}
              aria-busy={loading}
            >
              {loading
                ? (mode === 'signin' ? 'Signing in...' : 'Creating account...')
                : (mode === 'signin' ? 'Sign In' : 'Create Account')}
            </button>
          </form>

          <p className="auth-switch-hint">
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              className="btn-link"
              onClick={switchMode}
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>

        <p className="auth-footer-note">
          Student accounts are created automatically. Staff and admin access must be assigned by the canteen administrator.
        </p>
      </div>
    </div>
  );
}
