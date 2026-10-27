interface Props {
  liveText: string
  listening: boolean
}

export function TranscriptPanel({ liveText, listening }: Props) {
  return (
    <section className="transcript-panel" aria-live="polite">
      <h2 className="panel-title">实时转写</h2>
      <div className={`live-box ${listening ? 'live-box--active' : ''}`}>
        {liveText ? (
          <p className="live-text">{liveText}</p>
        ) : (
          <p className="live-placeholder">
            {listening
              ? '连续聆听中，请自然说话；静音间隙会自动断句并识别…'
              : '点击「开始聆听」后可持续说话，中间状态会显示在这里'}
          </p>
        )}
      </div>
    </section>
  )
}
