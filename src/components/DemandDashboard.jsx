import React, { useMemo } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { calculateDemandMetrics } from '../utils/demand.js';
import { getLocalDateKey } from '../utils/dates.js';

export default function DemandDashboard() {
  const { orders, menu, settings, updateBufferRate } = useApp();

  const bufferRate = settings.bufferRate || 0.10;
  const bufferPercent = Math.round(bufferRate * 100);
  const todayKey = getLocalDateKey();

  // Pure demand calculation
  const metrics = useMemo(() => {
    return calculateDemandMetrics(orders, menu, bufferRate, todayKey);
  }, [orders, menu, bufferRate, todayKey]);

  // Max value for CSS bar chart scaling
  const maxBarValue = useMemo(() => {
    if (metrics.itemDemandList.length === 0) return 10;
    const highest = Math.max(...metrics.itemDemandList.map((i) => i.recommended));
    return Math.max(highest, 5);
  }, [metrics.itemDemandList]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="page-content demand-dashboard-page">
      <section className="demand-header-section">
        <div>
          <span className="eyebrow-tag">DEMAND MANAGEMENT</span>
          <h1 className="hero-title">What to cook, right now</h1>
          <p className="hero-subtitle">
            Live totals from pending pre-orders, with a buffer for walk-ins.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-outline print-btn no-print"
          onClick={handlePrint}
          aria-label="Print kitchen prep list"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
          Print Prep Sheet
        </button>
      </section>

      {/* Top Metric Cards */}
      <section className="demand-metrics-grid" aria-label="Key Performance Indicators">
        <div className="metric-card metric-card-highlight">
          <span className="metric-label">UNITS TO PREPARE</span>
          <div className="metric-value">{metrics.unitsToPrepare}</div>
          <span className="metric-hint">
            {metrics.itemDemandList.reduce((s, it) => s + it.totalOrdered, 0)} pre-ordered + {bufferPercent}% buffer
          </span>
        </div>

        <div className="metric-card">
          <span className="metric-label">ACTIVE ORDERS</span>
          <div className="metric-value">{metrics.activeOrdersCount}</div>
          <span className="metric-hint">Placed, preparing or ready</span>
        </div>

        <div className="metric-card">
          <span className="metric-label">ORDERS TODAY</span>
          <div className="metric-value">{metrics.todayOrdersCount}</div>
          <span className="metric-hint">Total non-expired today</span>
        </div>

        <div className="metric-card">
          <span className="metric-label">REVENUE TODAY</span>
          <div className="metric-value">₹{metrics.revenueToday.toLocaleString('en-IN')}</div>
          <span className="metric-hint">Pre-orders booked today</span>
        </div>
      </section>

      {/* Main Grid: Prep List + Right Sidebar Controls */}
      <div className="demand-two-col-layout">
        {/* Left: Prep List Table */}
        <section className="prep-list-card" aria-label="Kitchen Preparation List">
          <div className="prep-card-header">
            <div>
              <h2 className="prep-card-title">Prep list</h2>
              <span className="prep-card-subtitle">
                Still to cook + (+{bufferPercent}% buffer), rounded up
              </span>
            </div>
            <span className="items-count-tag">{metrics.itemDemandList.length} items</span>
          </div>

          {metrics.itemDemandList.length === 0 ? (
            <div className="empty-prep-state">
              <p>No food ordered today yet. As pre-orders arrive, the kitchen prep sheet will populate automatically.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="canteen-table prep-table">
                <thead>
                  <tr>
                    <th>ITEM</th>
                    <th className="text-right">ORDERED</th>
                    <th className="text-right">BUFFER</th>
                    <th className="text-right">PREPARE</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.itemDemandList.map((row) => (
                    <tr key={row.itemId}>
                      <td className="item-name-cell">
                        <strong>{row.name}</strong>
                        <span className="item-category-micro">{row.category}</span>
                      </td>
                      <td className="text-right font-medium">{row.totalOrdered}</td>
                      <td className="text-right text-muted">+{row.buffer}</td>
                      <td className="text-right">
                        <span className="prep-target-pill">
                          {row.recommended}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Right Column: Walk-in Buffer + Category Distribution */}
        <aside className="demand-sidebar" aria-label="Dashboard Controls and Category Breakdown">
          {/* Buffer Control Card */}
          <div className="dashboard-widget buffer-widget">
            <div className="buffer-widget-header">
              <span className="widget-label">WALK-IN BUFFER</span>
              <span className="buffer-value-display">+{bufferPercent}%</span>
            </div>

            <div className="slider-wrapper">
              <input
                type="range"
                min="0"
                max="0.50"
                step="0.05"
                value={bufferRate}
                onChange={(e) => updateBufferRate(parseFloat(e.target.value))}
                className="buffer-slider"
                aria-label="Walk-in buffer percentage"
              />
              <div className="slider-ticks">
                <span>0%</span>
                <span>25%</span>
                <span>50%</span>
              </div>
            </div>

            <p className="buffer-explanation-text">
              Extra portions for students who don&apos;t pre-order.
            </p>
            <div className="buffer-disclaimer-callout">
              <strong>Rule Note:</strong> Simple demonstration rule: <code>recommended = ordered + Math.ceil(ordered × {bufferRate})</code>. This is a heuristic buffer calculation, not an AI prediction.
            </div>
          </div>

          {/* By Category Distribution Card */}
          <div className="dashboard-widget category-widget">
            <h3 className="widget-title">By category</h3>
            <div className="category-bars-list">
              {Object.keys(metrics.categoryDemandMap).length === 0 ? (
                <p className="empty-mini-text">No category data today.</p>
              ) : (
                Object.entries(metrics.categoryDemandMap).map(([cat, total]) => {
                  const maxCat = Math.max(...Object.values(metrics.categoryDemandMap), 1);
                  const pct = Math.round((total / maxCat) * 100);
                  return (
                    <div key={cat} className="category-bar-row">
                      <div className="cat-meta-row">
                        <span className="cat-name">{cat}</span>
                        <span className="cat-val">{total} portions</span>
                      </div>
                      <div className="cat-bar-track">
                        <div
                          className="cat-bar-fill"
                          style={{ width: `${Math.max(pct, 6)}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Ordered Today Chips */}
          <div className="dashboard-widget ordered-today-widget">
            <h3 className="widget-title">Ordered today</h3>
            <div className="ordered-chips-flow">
              {metrics.itemDemandList.length === 0 ? (
                <p className="empty-mini-text">No items ordered today yet.</p>
              ) : (
                metrics.itemDemandList.map((item) => (
                  <span key={item.itemId} className="ordered-summary-chip">
                    {item.name}: <strong>{item.totalOrdered}</strong>
                  </span>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Bottom Card: Pure CSS Horizontal Bar Chart */}
      <section className="demand-chart-card" aria-label="Demand Comparison Chart">
        <div className="chart-header">
          <h2 className="chart-title">Demand per item</h2>
          <span className="chart-subtitle">Pre-ordered vs Recommended kitchen prep</span>
        </div>

        {metrics.itemDemandList.length === 0 ? (
          <p className="empty-chart-text">Chart will appear once pre-orders are logged.</p>
        ) : (
          <div className="horizontal-barchart-container">
            <div className="barchart-items">
              {metrics.itemDemandList.map((item) => {
                const preorderedPct = Math.min(100, Math.round((item.totalOrdered / maxBarValue) * 100));
                const recommendedPct = Math.min(100, Math.round((item.recommended / maxBarValue) * 100));

                return (
                  <div key={item.itemId} className="barchart-row">
                    <div className="barchart-label-col">
                      <span className="barchart-item-name">{item.name}</span>
                    </div>

                    <div className="barchart-bars-col">
                      {/* Pre-ordered bar (Dark) */}
                      <div className="bar-wrapper">
                        <div
                          className="bar-fill bar-preordered"
                          style={{ width: `${Math.max(preorderedPct, 3)}%` }}
                          title={`Pre-ordered: ${item.totalOrdered}`}
                        >
                          <span className="bar-val-badge">{item.totalOrdered}</span>
                        </div>
                      </div>

                      {/* Recommended bar (Terracotta Accent) */}
                      <div className="bar-wrapper">
                        <div
                          className="bar-fill bar-recommended"
                          style={{ width: `${Math.max(recommendedPct, 3)}%` }}
                          title={`Recommended Prep: ${item.recommended}`}
                        >
                          <span className="bar-val-badge">{item.recommended}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="barchart-legend">
              <div className="legend-item">
                <span className="legend-swatch swatch-preordered" />
                <span>Pre-ordered</span>
              </div>
              <div className="legend-item">
                <span className="legend-swatch swatch-recommended" />
                <span>Recommended prep</span>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
