import type { HistoryItem } from '../hooks/useVoiceSTT'

interface Props {
  items: HistoryItem[]
  onClear: () => void
  onRemove: (id: string) => void
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    return true
  }
}

export function HistoryList({ items, onClear, onRemove }: Props) {
  return (
    <section className="history-panel">
      <div className="panel-head">
        <h2 className="panel-title">已确认记录</h2>
        {items.length > 0 && (
          <button type="button" className="link-btn" onClick={onClear}>
            清空
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="empty-hint">暂无记录。连续说话时，每句按静音断句后会陆续写入这里。</p>
      ) : (
        <ul className="history-list">
          {items.map((item) => (
            <li key={item.id} className="history-item">
              <p className="history-text">{item.text}</p>
              <div className="history-meta">
                <time dateTime={new Date(item.at).toISOString()}>
                  {new Date(item.at).toLocaleTimeString('zh-CN', { hour12: false })}
                </time>
                {typeof item.durationMs === 'number' && (
                  <span className="history-duration" title={`${item.durationMs} ms`}>
                    识别用时 {(item.durationMs / 1000).toFixed(2)}s
                  </span>
                )}
                <span className="history-lang">{item.lang}</span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => copyText(item.text)}
                >
                  复制
                </button>
                <button type="button" className="link-btn danger" onClick={() => onRemove(item.id)}>
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <button
          type="button"
          className="secondary-btn"
          onClick={() => copyText(items.map((i) => i.text).join('\n'))}
        >
          复制全部
        </button>
      )}
    </section>
  )
}
