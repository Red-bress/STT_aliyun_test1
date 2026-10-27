import type { AsrStatus } from '../asr'

const LABELS: Record<AsrStatus, string> = {
  idle: '空闲',
  listening: '连续聆听中',
  processing: '识别中（继续听）',
  error: '错误',
}

interface Props {
  status: AsrStatus
  detail?: string
  providerLabel: string
  available: boolean
}

export function StatusBar({ status, detail, providerLabel, available }: Props) {
  return (
    <div className={`status-bar status-bar--${status}`} role="status">
      <span className="status-dot" />
      <span className="status-text">
        {LABELS[status]}
        {detail ? ` · ${detail}` : ''}
      </span>
      <span className="status-provider">
        {providerLabel}
        {!available ? '（不可用）' : ''}
      </span>
    </div>
  )
}
