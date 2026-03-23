import React from 'react'

interface SessionSummary {
  readonly id: number
  readonly title: string
  readonly started_at: string
  readonly duration_seconds: number | null
  readonly status: string
}

interface HistoryPanelProps {
  readonly sessions: readonly SessionSummary[]
  readonly currentSessionId: number | null
  readonly onSelectSession: (id: number) => void
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '--:--'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function HistoryPanel({
  sessions,
  currentSessionId,
  onSelectSession,
}: HistoryPanelProps): React.ReactElement {
  return (
    <div style={{
      width: '240px',
      backgroundColor: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        fontSize: '13px',
        color: 'var(--text-secondary)',
      }}>
        History ({sessions.length})
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sessions.map(session => (
          <div
            key={session.id}
            onClick={() => onSelectSession(session.id)}
            style={{
              padding: '10px 16px',
              cursor: 'pointer',
              borderBottom: '1px solid var(--border)',
              borderLeft: session.id === currentSessionId ? '3px solid var(--accent)' : '3px solid transparent',
              backgroundColor: session.id === currentSessionId ? 'var(--bg-tertiary)' : 'transparent',
            }}
          >
            <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '4px' }}>
              {session.title}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
              <span>{formatDate(session.started_at)}</span>
              <span>{formatDuration(session.duration_seconds)}</span>
            </div>
            {session.status === 'recording' && (
              <span style={{ fontSize: '10px', color: 'var(--danger)', fontWeight: 600 }}>RECORDING</span>
            )}
          </div>
        ))}
        {sessions.length === 0 && (
          <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            No sessions yet
          </div>
        )}
      </div>
    </div>
  )
}
