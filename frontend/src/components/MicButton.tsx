import type { AsrStatus } from '../asr'

interface Props {
  status: AsrStatus
  disabled?: boolean
  onStart: () => void
  onStopKeep: () => void
  onInterrupt: () => void
}

export function MicButton({ status, disabled, onStart, onStopKeep, onInterrupt }: Props) {
  const listening = status === 'listening' || status === 'processing'

  return (
    <div className="mic-cluster">
      <button
        type="button"
        className={`mic-btn ${listening ? 'mic-btn--active' : ''}`}
        disabled={disabled && !listening}
        onClick={() => (listening ? onStopKeep() : onStart())}
        aria-label={listening ? '停止并保留' : '开始连续聆听'}
        title={listening ? '停止录音并尽量识别当前缓冲' : '开始连续语音识别（静音自动断句）'}
      >
        <span className="mic-icon" aria-hidden>
          {listening ? '⏹' : '🎤'}
        </span>
        <span className="mic-label">{listening ? '停止并保留' : '开始连续聆听'}</span>
      </button>

      {listening && (
        <button
          type="button"
          className="interrupt-btn"
          onClick={onInterrupt}
          aria-label="打断并丢弃"
          title="立即打断：停止采集并丢弃当前未完成句子与排队"
        >
          打断 / 丢弃
        </button>
      )}
    </div>
  )
}
