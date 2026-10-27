import type { AsrProvider } from './types'
import { createLocalWhisperProvider } from './localWhisper'

export type { AsrProvider, AsrStatus, PartialResult, AsrStartOptions } from './types'
export { createLocalWhisperProvider }

export type ProviderId = 'whisper-local'

export function listProviders(): AsrProvider[] {
  return [createLocalWhisperProvider()]
}

export function createProvider(_id?: ProviderId): AsrProvider {
  return createLocalWhisperProvider()
}
