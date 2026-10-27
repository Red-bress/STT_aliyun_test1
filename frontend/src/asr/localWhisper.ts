/**
 * Local SenseVoice via backend WebSocket.
 * Mic stays on; server splits by silence gap and recognizes continuously
 * (queue while ASR busy — recording never blocked).
 * Includes client watchdog if server stays in "processing" too long.
 */

import type { AsrProvider, AsrStartOptions, AsrStatus, PartialResult } from './types'

const TARGET_SR = 16000
/** Fallback if server does not advertise timeout (ms). */
const DEFAULT_WATCHDOG_MS = 120_000
/** Extra grace beyond server ASR_TIMEOUT_SEC. */
const WATCHDOG_GRACE_MS = 15_000

function defaultWsUrl(): string {
  const loc = window.location
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${loc.host}/ws/asr`
}

export function createLocalWhisperProvider(): AsrProvider {
  let ws: WebSocket | null = null
  let audioCtx: AudioContext | null = null
  let mediaStream: MediaStream | null = null
  let processor: ScriptProcessorNode | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let wantListening = false
  let status: AsrStatus = 'idle'
  let asrTimeoutSec = 90
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null

  const partialListeners = new Set<(r: PartialResult) => void>()
  const statusListeners = new Set<(s: AsrStatus, detail?: string) => void>()
  const errorListeners = new Set<(message: string) => void>()

  const clearWatchdog = () => {
    if (watchdogTimer != null) {
      clearTimeout(watchdogTimer)
      watchdogTimer = null
    }
  }

  const armWatchdog = () => {
    clearWatchdog()
    const ms = Math.max(DEFAULT_WATCHDOG_MS, asrTimeoutSec * 1000 + WATCHDOG_GRACE_MS)
    watchdogTimer = setTimeout(() => {
      watchdogTimer = null
      const msg =
        `识别超时：超过约 ${Math.round(ms / 1000)} 秒未收到结果。` +
        '服务端可能卡住；若仍在聆听可继续说，或点「打断/丢弃」后重试 / 重启 start.bat。'
      emitError(msg)
      // Keep continuous session if mic still on
      if (wantListening) {
        setStatus('listening', '聆听中（上一段看门狗超时，可继续说）')
      } else {
        setStatus('error', '前端看门狗：识别超时')
      }
    }, ms)
  }

  const setStatus = (s: AsrStatus, detail?: string) => {
    status = s
    if (s === 'processing') {
      armWatchdog()
    } else if (s === 'listening' || s === 'idle' || s === 'error') {
      clearWatchdog()
    }
    statusListeners.forEach((cb) => cb(s, detail))
  }
  const emitError = (message: string) => {
    if (!message) return
    errorListeners.forEach((cb) => cb(message))
  }
  const emitPartial = (text: string, isFinal: boolean, durationMs?: number) => {
    if (isFinal) clearWatchdog()
    partialListeners.forEach((cb) => cb({ text, isFinal, durationMs }))
  }

  const cleanupAudio = () => {
    try {
      processor?.disconnect()
    } catch {}
    try {
      source?.disconnect()
    } catch {}
    processor = null
    source = null
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop())
      mediaStream = null
    }
    if (audioCtx) {
      void audioCtx.close().catch(() => {})
      audioCtx = null
    }
  }

  const closeWs = () => {
    clearWatchdog()
    if (ws) {
      try {
        ws.onclose = null
        ws.onerror = null
        ws.onmessage = null
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close()
        }
      } catch {}
      ws = null
    }
  }

  const handleServerMessage = (raw: string) => {
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(raw)
    } catch {
      return
    }
    const type = obj.type as string
    if (type === 'ready') {
      if (typeof obj.asr_timeout_sec === 'number' && (obj.asr_timeout_sec as number) > 0) {
        asrTimeoutSec = obj.asr_timeout_sec as number
      }
      setStatus(
        wantListening ? 'listening' : status,
        `模型 ${(obj.model as string) || ''} · ${(obj.device as string) || ''} · 超时 ${asrTimeoutSec}s · 连续识别`,
      )
    } else if (type === 'status') {
      const s = obj.status as AsrStatus
      // Never leave continuous session on a transient error status from a single segment
      if (s === 'error' && wantListening) {
        setStatus('listening', (obj.detail as string) || '聆听中（可继续说）')
        return
      }
      setStatus(s, (obj.detail as string) || undefined)
    } else if (type === 'partial') {
      const durationMs =
        typeof obj.duration_ms === 'number' ? (obj.duration_ms as number) : undefined
      emitPartial(String(obj.text || ''), Boolean(obj.is_final), durationMs)
    } else if (type === 'final') {
      const text = String(obj.text || '').trim()
      const durationMs =
        typeof obj.duration_ms === 'number' ? (obj.duration_ms as number) : undefined
      if (text) emitPartial(text, true, durationMs)
      emitPartial('', false)
    } else if (type === 'error') {
      const code = String(obj.code || '')
      const base = String(obj.message || '服务器错误')
      const msg = code === 'timeout' ? base : base
      emitError(msg)
      if (wantListening) {
        setStatus('listening', '聆听中（上一段识别出错，可继续说）')
      } else {
        setStatus('error', msg)
      }
    } else if (type === 'pong') {
      // heartbeat ack — no-op
    }
  }

  const downsampleTo16k = (input: Float32Array, inRate: number): Int16Array => {
    if (inRate === TARGET_SR) {
      const out = new Int16Array(input.length)
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]!))
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      return out
    }
    const ratio = inRate / TARGET_SR
    const newLen = Math.floor(input.length / ratio)
    const out = new Int16Array(newLen)
    for (let i = 0; i < newLen; i++) {
      const idx = Math.floor(i * ratio)
      const s = Math.max(-1, Math.min(1, input[idx]!))
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    return out
  }

  return {
    id: 'whisper-local',
    label: '本地 SenseVoice-Small（连续识别）',

    isAvailable() {
      return typeof WebSocket !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
    },

    async start(options: AsrStartOptions = {}) {
      if (wantListening) return
      wantListening = true
      emitError('')
      setStatus('listening', '连接本地识别服务…')

      const wsUrl = options.wsUrl || defaultWsUrl()
      const lang = options.lang || 'zh-CN'
      const silenceMs = options.silenceMs ?? 1000

      await new Promise<void>((resolve, reject) => {
        closeWs()
        const socket = new WebSocket(wsUrl)
        ws = socket
        const timer = setTimeout(() => {
          reject(new Error('连接本地服务超时。请先运行 start.bat 启动识别服务（端口 8765）。'))
          closeWs()
        }, 8000)
        socket.onopen = () => {
          clearTimeout(timer)
          socket.send(
            JSON.stringify({
              type: 'start',
              lang,
              silence_ms: silenceMs,
              continuous: true,
            }),
          )
          resolve()
        }
        socket.onerror = () => {
          clearTimeout(timer)
          reject(
            new Error(
              '无法连接本地 SenseVoice 服务 (ws://127.0.0.1:8765)。请先双击 start.bat。',
            ),
          )
        }
        socket.onmessage = (ev) => {
          if (typeof ev.data === 'string') handleServerMessage(ev.data)
        }
        socket.onclose = () => {
          clearWatchdog()
          if (wantListening) {
            emitError('与本地识别服务的连接已断开')
            setStatus('error', '连接断开')
            wantListening = false
            cleanupAudio()
          }
        }
      })

      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      audioCtx = new AudioContext()
      if (audioCtx.state === 'suspended') await audioCtx.resume()
      source = audioCtx.createMediaStreamSource(mediaStream)
      processor = audioCtx.createScriptProcessor(4096, 1, 1)
      processor.onaudioprocess = (ev) => {
        // Keep streaming PCM the whole session — server queues ASR, never blocks recording
        if (!wantListening || !ws || ws.readyState !== WebSocket.OPEN) return
        const input = ev.inputBuffer.getChannelData(0)
        const pcm = downsampleTo16k(input, audioCtx!.sampleRate)
        const ab = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer
        ws.send(ab)
      }
      source.connect(processor)
      processor.connect(audioCtx.destination)
      setStatus('listening', `连续聆听中（静音 ${silenceMs} ms 断句）`)
    },

    stop(finalize = true) {
      wantListening = false
      clearWatchdog()
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stop', finalize }))
      }
      cleanupAudio()
      setTimeout(() => {
        closeWs()
        setStatus('idle')
      }, 2000)
    },

    abort() {
      wantListening = false
      clearWatchdog()
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'abort' }))
      }
      cleanupAudio()
      closeWs()
      emitPartial('', false)
      setStatus('idle', '已打断并丢弃')
    },

    onPartial(cb) {
      partialListeners.add(cb)
      return () => partialListeners.delete(cb)
    },
    onStatus(cb) {
      statusListeners.add(cb)
      return () => statusListeners.delete(cb)
    },
    onError(cb) {
      errorListeners.add(cb)
      return () => errorListeners.delete(cb)
    },
  }
}
