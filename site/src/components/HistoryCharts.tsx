// ABOUTME: SVG sparkline charts for census history (RCI, crime, pollution, money).
// ABOUTME: React island that fetches /history endpoint and renders 6 inline sparklines.

import { useState, useEffect } from 'react';

interface CensusHistory {
  residential: number[];
  commercial: number[];
  industrial: number[];
  crime: number[];
  pollution: number[];
  money: number[];
}

interface Props {
  cityId: string;
  apiBase: string;
}

const CHART_WIDTH = 200;
const CHART_HEIGHT = 40;
const PADDING = 2;

const CHARTS: { key: keyof CensusHistory; label: string; color: string }[] = [
  { key: 'residential', label: 'Residential', color: '#22c55e' },
  { key: 'commercial', label: 'Commercial', color: '#3b82f6' },
  { key: 'industrial', label: 'Industrial', color: '#eab308' },
  { key: 'crime', label: 'Crime', color: '#ef4444' },
  { key: 'pollution', label: 'Pollution', color: '#a855f7' },
  { key: 'money', label: 'Money', color: '#06b6d4' },
];

function toPolyline(data: number[]): string {
  if (data.length === 0) return '';
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const drawW = CHART_WIDTH - PADDING * 2;
  const drawH = CHART_HEIGHT - PADDING * 2;

  return data
    .map((v, i) => {
      const x = PADDING + (i / (data.length - 1)) * drawW;
      const y = PADDING + drawH - ((v - min) / range) * drawH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export default function HistoryCharts({ cityId, apiBase }: Props) {
  const [history, setHistory] = useState<CensusHistory | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${apiBase}/v1/cities/${cityId}/history`)
      .then((r) => {
        if (!r.ok) throw new Error('fetch failed');
        return r.json();
      })
      .then((data: CensusHistory) => setHistory(data))
      .catch(() => setError(true));
  }, [cityId, apiBase]);

  if (error) return null;
  if (!history) {
    return (
      <div style={containerStyle}>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading history...</span>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <h3 style={titleStyle}>Census History</h3>
      <div style={gridStyle}>
        {CHARTS.map(({ key, label, color }) => {
          const data = history[key];
          const allZero = data.every((v) => v === 0);
          return (
            <div key={key} style={chartItemStyle}>
              <span style={chartLabelStyle}>{label}</span>
              <svg
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                width={CHART_WIDTH}
                height={CHART_HEIGHT}
                style={{ display: 'block' }}
              >
                {allZero ? (
                  <line
                    x1={PADDING}
                    y1={CHART_HEIGHT / 2}
                    x2={CHART_WIDTH - PADDING}
                    y2={CHART_HEIGHT / 2}
                    stroke={color}
                    strokeWidth="1"
                    opacity="0.3"
                  />
                ) : (
                  <polyline
                    points={toPolyline(data)}
                    fill="none"
                    stroke={color}
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                )}
              </svg>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '1.25rem',
  marginTop: '1.5rem',
};

const titleStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  margin: '0 0 0.75rem',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '0.75rem',
};

const chartItemStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
};

const chartLabelStyle: React.CSSProperties = {
  fontSize: '0.6875rem',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};
