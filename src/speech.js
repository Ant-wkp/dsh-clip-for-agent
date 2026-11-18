import { open } from 'node:fs/promises'
import { errorCopy } from './messages.js'

export const providerId = 'sensevoice-local'
const ready = new Set(['ready', 'standby'])
const preparing = new Set(['checking', 'loading', 'downloading', 'waking', 'cancelling'])
const maxSeconds = 120
const maxBytes = 4 * 1024 * 1024

export class ClipSpeechError extends Error {
  constructor(code, key = code, args) {
    super(errorCopy(key, args))
    this.code = code
    this.key = key
    this.args = args
  }
}

function provider(snapshot) {
  return snapshot?.providers.find(item => item.id === providerId && item.location === 'host-local')
}

export function speechStatus(snapshot) {
  const local = provider(snapshot)
  if (!local) return { phase: 'unavailable' }
  const { phase, completedBytes, totalBytes } = local.preparation
  if (phase !== 'downloading') return { phase }
  return { phase, completedBytes, ...(totalBytes !== undefined && { totalBytes }) }
}

export function speechLanguage(snapshot) {
  const language = snapshot?.selection.language ?? 'auto'
  return provider(snapshot)?.languages.includes(language) ? language : 'auto'
}

export function prepareLocalSpeech(speech) {
  const state = speechStatus(speech?.snapshot())
  if (state.phase === 'unavailable') {
    throw new ClipSpeechError('speech-unavailable')
  }
  if (!ready.has(state.phase) && !preparing.has(state.phase)) speech.prepare(providerId)
}

async function waitForProvider(speech, signal) {
  if (speech) for await (const state of speech.follow(signal)) {
    const { phase } = speechStatus(state)
    if (ready.has(phase)) return
    if (phase === 'unavailable') break
    if (phase === 'failed' || phase === 'cancelled' || phase === 'unprepared') {
      throw new ClipSpeechError('speech-prepare')
    }
  }
  signal.throwIfAborted()
  throw new ClipSpeechError('speech-unavailable')
}

const voiceBundle = '@deepseek-ai/dsh-experimental-voice-input-bundle'
const speechRows = ['speech-to-text', 'speech-to-text-sensevoice']

function checkInstall(result) {
  if (result.application === 'applied' || result.application === 'restart-required') {
    return result.application
  }
  throw new ClipSpeechError('speech-install-failed', 'speech-install-incomplete', {
    reason: result.error?.code ?? result.application,
  })
}

export async function installOfficialSpeech(manager, hasSpeechService) {
  if (!manager) {
    throw new ClipSpeechError('speech-install-unavailable', 'speech-manager-unavailable')
  }
  const [bundles, entries] = await Promise.all([manager.listBundles(), manager.listPlugins()])
  const bundle = bundles.find(item => item.name === voiceBundle && item.official)
  // Reuse the current DSH installation's Host modules. Enable the existing
  // rows in place so there is still only one recognition registry.
  const rows = speechRows.map(name => entries.find(row =>
    row.patchId === (bundle?.enabled ? name : 'clip-' + name) &&
    row.moduleName === '@deepseek-ai/dsh-experimental-' + name))
  if (rows.every(row => row?.fiberPhase !== 'failed' && row?.entryId)) {
    let status = 'applied'
    for (const row of rows) {
      if (!row.enabled && checkInstall(await manager.setPluginEnabled(row.entryId, true)) === 'restart-required') {
        status = 'restart-required'
      }
    }
    return status
  }
  if (hasSpeechService || bundle?.enabled) {
    throw new ClipSpeechError('speech-install-failed', 'speech-component-failed')
  }
  if (bundle?.availability && bundle.availability !== 'missing') {
    return checkInstall(await manager.setBundleEnabled(voiceBundle, true))
  }
  const spec = bundle?.installTarget?.spec
  if (!spec) {
    throw new ClipSpeechError('speech-install-unavailable')
  }
  return checkInstall(await manager.installBundle(spec, { saveExact: true }))
}

export async function transcribeClip(speech, recording, language, signal, onTranscribing) {
  if (recording.durationSeconds > maxSeconds || recording.wavBytes > maxBytes) {
    throw new ClipSpeechError('too-long')
  }
  await waitForProvider(speech, signal)
  const file = await open(recording.wav, 'r')
  let audio
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size !== recording.wavBytes || stat.size > maxBytes || stat.size < 46) {
      throw new ClipSpeechError('invalid-audio')
    }
    audio = Buffer.alloc(stat.size)
    let offset = 0
    while (offset < audio.length) {
      const { bytesRead } = await file.read(audio, offset, audio.length - offset)
      if (!bytesRead) throw new ClipSpeechError('invalid-audio')
      offset += bytesRead
    }
  } finally {
    await file.close()
  }
  signal.throwIfAborted()
  onTranscribing()
  return await speech.transcribe(speech.resolve({ providerId, language, audio }), signal)
}
