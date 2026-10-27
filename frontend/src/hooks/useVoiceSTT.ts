import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createProvider,
  type AsrProvider,
  type AsrStatus,
  type ProviderId,
} from '../asr'

export interface HistoryItem {
  id: string
  text: string
  at: number
  lang: string
  /** ASR wall time in ms (from local Whisper server) */
  durationMs?: number
}

export function useVoiceSTT(initialProvider: ProviderId = 'whisper-local') {
  const providerRef = useRef<AsrProvider | null>(null)
  const [providerId, setProviderId] = useState<ProviderId>(initialProvider)
  const [status, setStatus] = useState<AsrStatus>('idle')
  const [statusDetail, setStatusDetail] = useState<string>('')
  const [liveText, setLiveText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [lang, setLang] = useState('zh-CN')
  const [silenceMs, setSilenceMs] = useState(1000)
  const [available, setAvailable] = useState(false)
  const liveBufferRef = useRef('')

  useEffect(() => {
    const p = createProvider(providerId)
    providerRef.current = p
    setAvailable(p.isAvailable())
    setError(null)
    setLiveText('')
    liveBufferRef.current = ''

    const offPartial = p.onPartial((r) => {
      if (r.isFinal) {
        const text = r.text.trim()
        if (text) {
          setHistory((h) => [
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              text,
              at: Date.now(),
              lang,
              durationMs: r.durationMs,
            },
            ...h,
          ])
        }
        setLiveText('')
        liveBufferRef.current = ''
      } else {
        liveBufferRef.current = r.text
        setLiveText(r.text)
      }
    })

    const offStatus = p.onStatus((s, detail) => {
      setStatus(s)
      setStatusDetail(detail ?? '')
      if (s === 'listening') {
        setError((prev) => (prev && prev.includes('正在') ? null : prev))
      }
    })

    const offError = p.onError((msg) => {
      if (msg) setError(msg)
    })

    return () => {
      offPartial()
      offStatus()
      offError()
      p.abort()
    }
  }, [providerId, lang])

  const start = useCallback(async () => {
    setError(null)
    setLiveText('')
    liveBufferRef.current = ''
    try {
      await providerRef.current?.start({
        lang,
        continuous: true,
        interimResults: true,
        silenceMs,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [lang, silenceMs])

  const stopAndKeep = useCallback(() => {
    setError(null)
    providerRef.current?.stop(true)
  }, [])

  const interrupt = useCallback(() => {
    setLiveText('')
    liveBufferRef.current = ''
    setError(null)
    providerRef.current?.abort()
  }, [])

  const dismissError = useCallback(() => setError(null), [])
  const clearHistory = useCallback(() => setHistory([]), [])
  const removeItem = useCallback((id: string) => {
    setHistory((h) => h.filter((x) => x.id !== id))
  }, [])

  return {
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
  }
}
