/**
 * AnalyticsDashboard.jsx — Server-side financial analytics for staff/admin.
 *
 * Calls the get_analytics() RPC which runs SQL aggregation on the DB —
 * no raw order records are downloaded to the browser.
 *
 * Only shows verified captured payments as revenue (no double-counting).
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { fetchAnalytics } from '../services/paymentService.js';
import { isSupabaseConfigured } from '../lib/supabaseClient.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const formatRupees = (paise) =>
  '₹' + Math.round((paise || 0) / 100).toLocaleString('en-IN');

const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return dateStr; }
};

// ---------------------------------------------------------------------------
// Metric Card
// ---------------------------------------------------------------------------
function MetricCard({ label, value, sub, highlight }) {
  return (
    <div className={`metric-card ${highlight ? 'metric-card-highlight' : ''}`}>
      <span className="metric-label">{label}</span>
      <div className="metric-value">{value}</div>
      {sub && <span className="metric-hint">{sub}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini bar chart (CSS-only, no external library)
// ---------------------------------------------------------------------------
function BarChart({ data, valueKey, labelKey, colorClass, maxOverride }) {
  const maxVal = maxOverride || Math.max(...(data || []).map((d) => d[valueKey] || 0), 1);
  if (!data || data.length === 0) {
    return <p className="empty-chart-text">No data for this period.</p>;
  }

  return (
    <div className="analytics-bar-chart">
      {data.map((item, idx) => {
        const pct = Math.max(4, Math.round(((item[valueKey] || 0) / maxVal) * 100));
        return (
          <div key={idx} className="analytics-bar-row">
            <div className="analytics-bar-label">{item[labelKey]}</div>
            <div className="analytics-bar-track">
              <div
                className={`analytics-bar-fill ${colorClass || 'bar-primary'}`}
                style={{ width: `${pct}%` }}
                title={`${item[valueKey]}`}
              />
            </div>
            <div className="analytics-bar-value">{item[valueKey]}</div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily Revenue Chart
// ---------------------------------------------------------------------------
function DailyRevenueChart({ dailyData }) {
  const chartData = useMemo(() => {
    if (!dailyData) return [];
    return dailyData.slice(-14).map((d) => ({
      label: formatDate(d.date),
      value: Math.round((d.gross_paise || 0) / 100),
      orders: d.paid_orders || 0
    }));
  }, [dailyData]);

  const maxVal = useMemo(() =>
    Math.max(...chartData.map((d) => d.value), 1),
  [chartData]);

  if (chartData.length === 0) {
    return <p className="empty-chart-text">No daily revenue data.</p>;
  }

  return (
    <div className="daily-revenue-chart">
      {chartData.map((day, idx) => {
        const pct = Math.max(4, Math.round((day.value / maxVal) * 100));
        return (
          <div key={idx} className="daily-rev-col">
            <div className="daily-rev-bar-wrapper">
              <div
                className="daily-rev-bar"
                style={{ height: `${pct}%` }}
                title={`${day.label}: ₹${day.value.toLocaleString('en-IN')} (${day.orders} orders)`}
              />
            </div>
            <div className="daily-rev-label">{day.label.split(' ').slice(0, 2).join(' ')}</div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main AnalyticsDashboard
// ---------------------------------------------------------------------------
export default function AnalyticsDashboard() {
  const { role } = useApp();
  const [analytics, setAnalytics]   = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [dateRange, setDateRange]   = useState('30d');

  // Date range helpers
  const getDateRange = useCallback((range) => {
    const today = new Date();
    const toDate = today.toISOString().split('T')[0];
    let fromDate;

    switch (range) {
      case '7d':
        fromDate = new Date(today.setDate(today.getDate() - 7)).toISOString().split('T')[0];
        break;
      case '30d':
        fromDate = new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0];
        break;
      case '90d':
        fromDate = new Date(new Date().setDate(new Date().getDate() - 90)).toISOString().split('T')[0];
        break;
      default:
        fromDate = null;
    }
    return { fromDate, toDate };
  }, []);

  const loadAnalytics = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setError('Analytics require Supabase connection.');
      return;
    }

    setLoading(true);
    setError(null);

    const { fromDate, toDate } = getDateRange(dateRange);
    const { data, error: fetchError } = await fetchAnalytics({ fromDate, toDate });

    if (fetchError) {
      setError(fetchError.message || 'Failed to load analytics.');
    } else {
      setAnalytics(data);
    }
    setLoading(false);
  }, [dateRange, getDateRange]);

  useEffect(() => {
    if (role === 'staff' || role === 'admin') {
      loadAnalytics();
    }
  }, [role, loadAnalytics]);

  // Guard: only staff/admin
  if (role !== 'staff' && role !== 'admin') {
    return (
      <div className="page-content">
        <div className="empty-state-box">
          <div className="empty-state-icon">🔒</div>
          <h2 className="empty-state-title">Access Restricted</h2>
          <p>Only staff and admin can view analytics.</p>
        </div>
      </div>
    );
  }

  const netRevenue   = analytics ? (analytics.gross_revenue_paise || 0) - (analytics.refund_total_paise || 0) : 0;
  const topItems     = analytics?.top_items || [];
  const peakHours    = analytics?.peak_hours || [];
  const lowStock     = analytics?.low_stock_items || [];
  const dailyRevenue = analytics?.daily_revenue || [];

  return (
    <div className="page-content analytics-dashboard-page">
      {/* Header */}
      <section className="demand-header-section">
        <div>
          <span className="eyebrow-tag">FINANCIAL ANALYTICS</span>
          <h1 className="hero-title">Revenue &amp; Performance</h1>
          <p className="hero-subtitle">
            Only verified captured payments are counted. Refunds are deducted.
          </p>
        </div>

        <div className="analytics-controls">
          <div className="date-range-selector" role="group" aria-label="Date range">
            {[{ value: '7d', label: '7 Days' }, { value: '30d', label: '30 Days' }, { value: '90d', label: '90 Days' }].map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`date-range-btn ${dateRange === opt.value ? 'active' : ''}`}
                onClick={() => setDateRange(opt.value)}
                aria-pressed={dateRange === opt.value}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="btn btn-outline"
            onClick={loadAnalytics}
            disabled={loading}
            aria-label="Refresh analytics"
          >
            {loading ? <><span className="spinner spinner-xs" /> Refreshing…</> : '↻ Refresh'}
          </button>
        </div>
      </section>

      {/* Error */}
      {error && (
        <div className="alert-banner alert-danger" role="alert">
          <strong>Analytics error:</strong> {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="loading-state-center">
          <div className="spinner" role="status" aria-label="Loading analytics…" />
          <p className="loading-hint">Loading analytics…</p>
        </div>
      )}

      {/* Analytics content */}
      {!loading && analytics && (
        <>
          {/* Key Metrics */}
          <section className="demand-metrics-grid" aria-label="Revenue Metrics">
            <MetricCard
              label="GROSS REVENUE"
              value={formatRupees(analytics.gross_revenue_paise)}
              sub={`${analytics.paid_orders || 0} paid orders`}
              highlight
            />
            <MetricCard
              label="NET REVENUE"
              value={formatRupees(netRevenue)}
              sub={`After ₹${Math.round((analytics.refund_total_paise || 0) / 100).toLocaleString('en-IN')} refunds`}
            />
            <MetricCard
              label="AVG ORDER VALUE"
              value={formatRupees(analytics.avg_order_value_paise)}
              sub="Per paid order"
            />
            <MetricCard
              label="TOTAL ORDERS"
              value={analytics.total_orders || 0}
              sub={`${analytics.cancelled_orders || 0} cancelled · ${analytics.failed_payments || 0} failed payments`}
            />
          </section>

          <div className="analytics-two-col">
            {/* Daily Revenue Chart */}
            <section className="analytics-card daily-chart-card" aria-label="Daily Revenue Chart">
              <div className="analytics-card-header">
                <h2 className="analytics-card-title">Daily Revenue</h2>
                <span className="analytics-card-sub">Last {dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90} days</span>
              </div>
              <div className="daily-revenue-chart-wrapper">
                <DailyRevenueChart dailyData={dailyRevenue} />
              </div>
            </section>

            {/* Top Items */}
            <section className="analytics-card" aria-label="Best Selling Items">
              <div className="analytics-card-header">
                <h2 className="analytics-card-title">Best Sellers</h2>
                <span className="analytics-card-sub">By quantity sold</span>
              </div>
              {topItems.length === 0 ? (
                <p className="empty-chart-text">No sales data for this period.</p>
              ) : (
                <div className="top-items-list">
                  {topItems.map((item, idx) => (
                    <div key={idx} className="top-item-row">
                      <div className="top-item-rank">#{idx + 1}</div>
                      <div className="top-item-info">
                        <div className="top-item-name">{item.item_name}</div>
                        <div className="top-item-meta">
                          {item.total_quantity} sold · {item.order_count} orders
                        </div>
                      </div>
                      <div className="top-item-revenue">
                        {formatRupees(item.revenue_paise)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="analytics-two-col">
            {/* Peak Hours */}
            <section className="analytics-card" aria-label="Peak Ordering Hours">
              <div className="analytics-card-header">
                <h2 className="analytics-card-title">Peak Hours</h2>
                <span className="analytics-card-sub">IST — orders placed</span>
              </div>
              {peakHours.length === 0 ? (
                <p className="empty-chart-text">No peak hour data.</p>
              ) : (
                <BarChart
                  data={peakHours.map((h) => ({
                    label: `${h.hour}:00`,
                    value: h.order_count
                  }))}
                  valueKey="value"
                  labelKey="label"
                  colorClass="bar-accent"
                />
              )}
            </section>

            {/* Low Stock Alerts */}
            <section className="analytics-card" aria-label="Low Stock Alerts">
              <div className="analytics-card-header">
                <h2 className="analytics-card-title">Low Stock Alerts</h2>
                <span className="analytics-card-sub">Items near depletion</span>
              </div>
              {lowStock.length === 0 ? (
                <div className="empty-state-inline">
                  <span style={{ fontSize: '24px' }}>✅</span>
                  <p>All items have sufficient stock.</p>
                </div>
              ) : (
                <div className="low-stock-list">
                  {lowStock.map((item, idx) => (
                    <div key={idx} className={`low-stock-row ${item.stock === 0 ? 'out-of-stock' : ''}`}>
                      <div className="low-stock-name">{item.item_name}</div>
                      <div className="low-stock-meta">
                        <span className={`stock-badge ${item.stock === 0 ? 'badge-danger' : 'badge-warning'}`}>
                          {item.stock === 0 ? '🔴 Out of stock' : `🟡 ${item.stock} left`}
                        </span>
                        <span className="threshold-hint">(threshold: {item.threshold})</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Summary footer */}
          <section className="analytics-footer-note">
            <p>
              Period: {analytics.period_from} → {analytics.period_to} ·
              Revenue counts only <strong>verified captured payments</strong>.
              Refunds are deducted from gross to calculate net revenue.
            </p>
          </section>
        </>
      )}

      {/* Not configured state */}
      {!loading && !analytics && !error && !isSupabaseConfigured && (
        <div className="empty-state-box">
          <div className="empty-state-icon" aria-hidden="true">📊</div>
          <h2 className="empty-state-title">Analytics not available</h2>
          <p className="empty-state-text">
            Analytics require a live Supabase connection. Configure your environment variables.
          </p>
        </div>
      )}
    </div>
  );
}
