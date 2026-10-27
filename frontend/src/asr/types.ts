export type AsrStatus = 'idle' | 'listening' | 'processing' | 'error'

export interface PartialResult {
  text: string
  isFinal: boolean
  /** wall-clock ASR time from server, milliseconds */
  durationMs?: number
}

export interface AsrStartOptions {
  lang?: string
  continuous?: boolean
  interimResults?: boolean
  /** silence gap for sentence split, ms */
  silenceMs?: number
  /** websocket url, default ws://127.0.0.1:8765/ws/asr */
  wsUrl?: string
}

export interface AsrProvider {
  readonly id: string
  readonly label: string
  isAvailable(): boolean
  start(options?: AsrStartOptions): Promise<void>
  stop(finalize?: boolean): void
  abort(): void
  onPartial(cb: (r: PartialResult) => void): () => void
  onStatus(cb: (s: AsrStatus, detail?: string) => void): () => void
  onError(cb: (message: string) => void): () => void
}
