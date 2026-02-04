// ABOUTME: Pulsing green "LIVE" indicator with "Updated Xs ago" text.
// ABOUTME: Rendered into #live-indicator on active city pages by the polling orchestrator.

import { useState, useEffect } from 'react';

interface Props {
  lastUpdated: number; // timestamp ms
}

export default function LiveIndicator({ lastUpdated }: Props) {
  const [ago, setAgo] = useState(0);

  useEffect(() => {
    const tick = () => setAgo(Math.floor((Date.now() - lastUpdated) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  const label = ago < 2 ? 'just now' : `${ago}s ago`;

  return (
    <span style={containerStyle}>
      <span style={dotStyle} />
      <span style={liveStyle}>LIVE</span>
      <span style={agoStyle}>{label}</span>
    </span>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.375rem',
  fontSize: '0.75rem',
  fontWeight: 600,
};

const dotStyle: React.CSSProperties = {
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  background: '#22c55e',
  boxShadow: '0 0 6px #22c55e',
  animation: 'live-pulse 2s ease-in-out infinite',
};

const liveStyle: React.CSSProperties = {
  color: '#22c55e',
  letterSpacing: '0.05em',
};

const agoStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontWeight: 400,
};
