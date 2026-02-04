// ABOUTME: Shows elapsed time since last city activity.
// ABOUTME: Green pulsing dot when recent (<5min), grey static dot when stale.

import { useState, useEffect } from 'react';

interface Props {
  lastUpdated: number; // timestamp ms — time of last detected city activity
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const RECENT_THRESHOLD = 5 * 60 * 1000; // 5 minutes

export default function LiveIndicator({ lastUpdated }: Props) {
  const [elapsed, setElapsed] = useState(Date.now() - lastUpdated);

  useEffect(() => {
    const tick = () => setElapsed(Date.now() - lastUpdated);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  const isRecent = elapsed < RECENT_THRESHOLD;

  return (
    <span style={containerStyle}>
      <span style={isRecent ? dotActiveStyle : dotStaleStyle} />
      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
        Updated {formatElapsed(elapsed)}
      </span>
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

const dotBase: React.CSSProperties = {
  width: '8px',
  height: '8px',
  borderRadius: '50%',
};

const dotActiveStyle: React.CSSProperties = {
  ...dotBase,
  background: '#22c55e',
  boxShadow: '0 0 6px #22c55e',
  animation: 'live-pulse 2s ease-in-out infinite',
};

const dotStaleStyle: React.CSSProperties = {
  ...dotBase,
  background: '#6b7280',
};
