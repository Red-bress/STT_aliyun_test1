import { MicButton } from './components/MicButton'
import { StatusBar } from './components/StatusBar'
import { TranscriptPanel } from './components/TranscriptPanel'
import { HistoryList } from './components/HistoryList'
import { useVoiceSTT } from './hooks/useVoiceSTT'
import { listProviders, type ProviderId } from './asr'

const LANGS = [
  { value: 'zh-CN', label: '中文（简体）' },
  { value: 'zh-TW', label: '中文（繁体）' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'ja-JP', label: '日本語' },
]

function App() {
  const {
    providerId,
    setProviderId,
    available,
    status,
    statusDetail,
    liveText,
    error,
    history,
    lang,
    setLang,
    silenceMs,
    setSilenceMs,
    start,
    stopAndKeep,
    interrupt,
    dismissError,
    clearHistory,
    removeItem,
  } = useVoiceSTT('whisper-local')

  const providers = listProviders()
  const current = providers.find((p) => p.id === providerId) ?? providers[0]
  const listening = status === 'listening' || status === 'processing'

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>语音转文字（离线）</h1>
          <p className="subtitle">
            本地 SenseVoice-Small · 连续识别 · 静音断句 · 识别超时保护 · 无需联网
          </p>
        </div>
        <StatusBar
          status={status}
          detail={statusDetail}
          providerLabel={current.label}
          available={available}
        />
      </header>

      <main className="app-main">
        <section className="controls">
          <label className="field">
            <span>识别引擎</span>
            <select
              value={providerId}
              disabled={listening}
              onChange={(e) => setProviderId(e.target.value as ProviderId)}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>语言</span>
            <select value={lang} disabled={listening} onChange={(e) => setLang(e.target.value)}>
              {LANGS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>断句静音 (ms)</span>
            <select
              value={silenceMs}
              disabled={listening}
              onChange={(e) => setSilenceMs(Number(e.target.value))}
            >
              <option value={800}>800</option>
              <option value={1000}>1000（推荐）</option>
              <option value={1200}>1200</option>
              <option value={1500}>1500</option>
            </select>
          </label>

          <MicButton
            status={status}
            disabled={!available}
            onStart={start}
            onStopKeep={stopAndKeep}
            onInterrupt={interrupt}
          />

          {error && (
            <div className="hint error error-box">
              <p>{error}</p>
              <button type="button" className="link-btn" onClick={dismissError}>
                关闭提示
              </button>
            </div>
          )}
        </section>

        <TranscriptPanel liveText={liveText} listening={listening} />
        <HistoryList items={history} onClear={clearHistory} onRemove={removeItem} />
      </main>

      <footer className="app-footer">
        <p>
          <strong>连续识别：</strong>
          点「开始聆听」后麦克风一直开着，按你的讲话节奏（静音约 {silenceMs}{' '}
          ms）自动断句；每一句立刻送本机 SenseVoice，结果陆续写入「已确认记录」。识别某一句时仍继续录音，下一段会排队。
        </p>
        <p>
          <strong>按钮：</strong>
          「停止并保留」结束并尽量识别当前缓冲；「打断 / 丢弃」立即停麦并丢弃未完成内容与排队。
        </p>
        <p className="muted">
          已切断 Web Speech 在线识别。双击 start.bat 启动；可用环境变量 ASR_TIMEOUT_SEC /
          SILENCE_MS / MAX_PENDING_UTTERANCES 调整。
        </p>
      </footer>
    </div>
  )
}

export default App
