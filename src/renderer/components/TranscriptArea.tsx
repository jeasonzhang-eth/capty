import React, { useEffect, useRef } from 'react'

interface Segment {
  readonly id: number
  readonly start_time: number
  readonly text: string
}

interface TranscriptAreaProps {
  readonly segments: readonly Segment[]
  readonly partialText: string
  readonly isRecording: boolean
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function TranscriptArea({
  segments,
  partialText,
  isRecording,
}: TranscriptAreaProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [segments, partialText])

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: '16px 24px',
    }}>
      {segments.map(seg => (
        <div key={seg.id} style={{ marginBottom: '12px' }}>
          <span style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            marginRight: '8px',
            fontFamily: 'monospace',
          }}>
            {formatTime(seg.start_time)}
          </span>
          <span style={{ fontSize: '14px', lineHeight: 1.6 }}>{seg.text}</span>
        </div>
      ))}

      {isRecording && partialText && (
        <div style={{ marginBottom: '12px', opacity: 0.7 }}>
          <span style={{ fontSize: '14px', lineHeight: 1.6 }}>{partialText}</span>
          <span className="cursor-blink" style={{
            display: 'inline-block',
            width: '2px',
            height: '16px',
            backgroundColor: 'var(--accent)',
            marginLeft: '2px',
            verticalAlign: 'text-bottom',
          }} />
        </div>
      )}

      {!isRecording && segments.length === 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-muted)',
          fontSize: '14px',
        }}>
          Click Start to begin transcription
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
