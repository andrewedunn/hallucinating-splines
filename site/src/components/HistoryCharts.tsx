// ABOUTME: SVG sparkline charts for census history (RCI, crime, pollution, money).
// ABOUTME: React island with synced hover — mousing over any chart highlights the same year on all charts.

import { useState, useEffect, useRef, useCallback } from 'react';

interface CensusHistory {
  residential: number[];
  commercial: number[];
  industrial: number[];
  crime: number[];
  pollution: number[];
  money: number[];
}

interface Snapshot {
  game_year: number;
  funds: number;
  population: number;
}

interface Props {
  cityId: string;
  apiBase: string;
  gameYear?: number;
}

const CHART_WIDTH = 200;
const CHART_HEIGHT = 40;
const PADDING = 2;

// Each Hist120 entry is CENSUS_FREQUENCY_120 = 40 cityTime units = 10 months apart
const MONTHS_PER_ENTRY = 10;

interface ChartDef {
  key: string;
  label: string;
  color: string;
  isMoney?: boolean;
}

const CHARTS: ChartDef[] = [
  { key: 'residential', label: 'Residential', color: '#22c55e' },
  { key: 'commercial', label: 'Commercial', color: '#3b82f6' },
  { key: 'industrial', label: 'Industrial', color: '#eab308' },
  { key: 'crime', label: 'Crime', color: '#ef4444' },
  { key: 'pollution', label: 'Pollution', color: '#a855f7' },
  { key: 'funds', label: 'Funds', color: '#06b6d4', isMoney: true },
];

/** Trim trailing zeros from a newest-first history array and reverse to oldest-first for plotting. */
function prepareData(raw: number[]): number[] {
  let lastNonZero = raw.length - 1;
  while (lastNonZero > 0 && raw[lastNonZero] === 0) lastNonZero--;
  const trimmed = raw.slice(0, lastNonZero + 1);
  return trimmed.reverse();
}

function computePoints(data: number[]): { x: number; y: number }[] {
  if (data.length < 2) return [];
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const drawW = CHART_WIDTH - PADDING * 2;
  const drawH = CHART_HEIGHT - PADDING * 2;

  return data.map((v, i) => ({
    x: PADDING + (i / (data.length - 1)) * drawW,
    y: PADDING + drawH - ((v - min) / range) * drawH,
  }));
}

function pointsToPolyline(points: { x: number; y: number }[]): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function formatValue(value: number, isMoney: boolean): string {
  if (isMoney) return `$${value.toLocaleString()}`;
  return value.toLocaleString();
}

function Sparkline({
  data,
  years,
  color,
  label,
  gameYear,
  hoverFraction,
  onHover,
  isMoney,
}: {
  data: number[];
  years?: number[];
  color: string;
  label: string;
  gameYear: number;
  hoverFraction: number | null;
  onHover: (fraction: number | null) => void;
  isMoney: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const allZero = data.length < 2 || data.every((v) => v === 0);
  const points = allZero ? [] : computePoints(data);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const fraction = (e.clientX - rect.left) / rect.width;
      onHover(Math.max(0, Math.min(1, fraction)));
    },
    [onHover],
  );

  const handleMouseLeave = useCallback(() => onHover(null), [onHover]);

  // Map the shared hover fraction to this chart's data index
  const hoverIndex = hoverFraction !== null && !allZero
    ? Math.max(0, Math.min(data.length - 1, Math.round(hoverFraction * (data.length - 1))))
    : null;

  // Use explicit years array if provided (for snapshot-based charts), otherwise calculate
  const hoverYear = hoverIndex !== null
    ? (years ? years[hoverIndex] : Math.round(gameYear - ((data.length - 1 - hoverIndex) * MONTHS_PER_ENTRY) / 12))
    : null;
  const hoverValue = hoverIndex !== null ? data[hoverIndex] : null;
  const hoverPoint = hoverIndex !== null && points[hoverIndex] ? points[hoverIndex] : null;

  return (
    <div style={chartItemStyle}>
      <div style={chartHeaderStyle}>
        <span style={chartLabelStyle}>{label}</span>
        {hoverValue !== null && hoverYear !== null ? (
          <span style={{ ...tooltipStyle, color }}>{formatValue(hoverValue, isMoney)} · {hoverYear}</span>
        ) : null}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        style={{ display: 'block', width: '100%', height: 'auto', cursor: 'crosshair' }}
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
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
          <polyline points={pointsToPolyline(points)} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        )}
        {hoverPoint && (
          <>
            <line
              x1={hoverPoint.x}
              y1={PADDING}
              x2={hoverPoint.x}
              y2={CHART_HEIGHT - PADDING}
              stroke="var(--text-muted)"
              strokeWidth="0.5"
              opacity="0.5"
            />
            <circle cx={hoverPoint.x} cy={hoverPoint.y} r="2.5" fill={color} />
          </>
        )}
        {allZero && hoverFraction !== null && (
          <line
            x1={PADDING + hoverFraction * (CHART_WIDTH - PADDING * 2)}
            y1={PADDING}
            x2={PADDING + hoverFraction * (CHART_WIDTH - PADDING * 2)}
            y2={CHART_HEIGHT - PADDING}
            stroke="var(--text-muted)"
            strokeWidth="0.5"
            opacity="0.5"
          />
        )}
      </svg>
    </div>
  );
}

export default function HistoryCharts({ cityId, apiBase, gameYear = 1900 }: Props) {
  const [history, setHistory] = useState<CensusHistory | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [error, setError] = useState(false);
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${apiBase}/v1/cities/${cityId}/history`).then((r) => {
        if (!r.ok) throw new Error('fetch failed');
        return r.json();
      }),
      fetch(`${apiBase}/v1/cities/${cityId}/snapshots?limit=100`).then((r) => {
        if (!r.ok) throw new Error('fetch failed');
        return r.json();
      }),
    ])
      .then(([historyData, snapshotData]: [CensusHistory, { snapshots: Snapshot[] }]) => {
        setHistory(historyData);
        setSnapshots(snapshotData.snapshots);
      })
      .catch(() => setError(true));
  }, [cityId, apiBase]);

  const handleHover = useCallback((fraction: number | null) => {
    setHoverFraction(fraction);
  }, []);

  if (error) return null;
  if (!history || !snapshots) {
    return (
      <div style={containerStyle}>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading history...</span>
      </div>
    );
  }

  // Build funds data from snapshots (already sorted by year ASC from API)
  const fundsData = snapshots.map((s) => s.funds);
  const fundsYears = snapshots.map((s) => s.game_year);

  return (
    <div style={containerStyle} onMouseLeave={() => setHoverFraction(null)}>
      <h3 style={titleStyle}>Census History</h3>
      <div className="history-charts-grid" style={gridStyle}>
        {CHARTS.map(({ key, label, color, isMoney }) => {
          if (key === 'funds') {
            return (
              <Sparkline
                key={key}
                data={fundsData}
                years={fundsYears}
                color={color}
                label={label}
                gameYear={gameYear}
                hoverFraction={hoverFraction}
                onHover={handleHover}
                isMoney={true}
              />
            );
          }
          return (
            <Sparkline
              key={key}
              data={prepareData(history[key as keyof CensusHistory])}
              color={color}
              label={label}
              gameYear={gameYear}
              hoverFraction={hoverFraction}
              onHover={handleHover}
              isMoney={false}
            />
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

const chartHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  minHeight: '1rem',
};

const chartLabelStyle: React.CSSProperties = {
  fontSize: '0.6875rem',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const tooltipStyle: React.CSSProperties = {
  fontSize: '0.625rem',
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};
