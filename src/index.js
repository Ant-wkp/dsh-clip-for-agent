import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { clipDescriptors } from './contract.js'
import { errorCopy } from './messages.js'
import { ClipSpeechError, installOfficialSpeech, prepareLocalSpeech, speechLanguage, speechStatus, transcribeClip } from './speech.js'
import { ClipWorker } from './worker.js'

const packageName = 'dsh-clip-for-agent'
const recordingId = /^[0-9]{14}$/
const problem = (code, key = code, args) => new RemoteError('clip/' + code, errorCopy(key, args), { clipKey: key, ...(args && { args }) })
const logger = ctx => ctx.logger('clip')
const maxTasks = 16
const syncErrors = new Set([
  'link-lost',
  'file-not-ready',
  'transfer-timeout',
  'transfer-incomplete',
  'decode-failed',
  'still-recording',
  'device-rejected',
  'no-recording',
  'rtc-unavailable',
  'rtc-empty',
  'rtc-cache',
  'rtc-incomplete',
  'rtc-interrupted',
])
const syncError = (code, fallback) => syncErrors.has(code) ? code : fallback

export default class ClipRemote extends TypertRemoteService {
  static inject = ['typert', 'subprocess']
  _listeners = new Set()
  _state = { connection: 'disconnected', scanned: false, devices: [], device: null,
    speech: { phase: 'unavailable' }, speechInstall: null, task: null, pending: [], levels: [], error: null, errorKey: null,
    recovering: false, recordingCommand: null }
  _address
  _worker
  _lifetime = new AbortController()
  _running
  _settled
  _recording
  _tasks = new Map()
  _acknowledged = new Set()

  constructor(ctx) {
    super(ctx, 'clipRemote', { namespace: 'clip' })
    this._worker = new ClipWorker(ctx.subprocess, (event, data) => this._event(event, data))
    ctx.typert.register({
      package: packageName, face: 'host', schemas: [],
      model: { services: [], events: [], objects: [] }, invocations: clipDescriptors(),
    })
    ctx.inject(['speechToText'], scope => {
      scope.effect(() => {
        const lifetime = new AbortController()
        const signal = AbortSignal.any([lifetime.signal, this._lifetime.signal])
        const observing = this._observeSpeech(scope.speechToText, signal)
        return async () => {
          lifetime.abort()
          this._update({ speech: { phase: 'unavailable' } })
          await observing
        }
      })
    })
    ctx.effect(() => async () => {
      this._lifetime.abort()
      for (const listener of this._listeners) listener()
      await Promise.allSettled([this._worker.dispose(), this._settled])
    })
  }

  async _observeSpeech(speech, signal) {
    try {
      for await (const snapshot of speech.follow(signal)) {
        this._update({ speech: speechStatus(snapshot) })
      }
    } catch (error) {
      if (!signal.aborted) logger(this.ctx).warn('speech readiness: %s', error.message)
    }
  }

  _update(patch) {
    if (this._lifetime.signal.aborted) return
    this._state = { ...this._state, ...patch }
    for (const listener of this._listeners) listener()
  }

  _setError(key, patch) {
    this._update({ ...patch, error: key ? errorCopy(key) : null, errorKey: key })
  }

  _publish(patch) {
    const queued = [...this._tasks.values()].find(task => task.phase === 'syncing')
    const active = this._recording ?? this._running ?? queued
    const pending = []
    for (const task of this._tasks.values()) {
      if (!['error', 'empty', 'transcript'].includes(task.phase)) continue
      pending.push({
        id: task.id, phase: task.phase, retryable: task.retryable ?? false,
        ...(task.sessionId && { sessionId: task.sessionId }),
        ...(task.error && { message: errorCopy(task.error, task.errorArgs), messageKey: task.error,
          ...(task.errorArgs && { messageArgs: task.errorArgs }) }),
        ...(task.text && { text: task.text }),
        ...(task.recording && { durationSeconds: task.recording.durationSeconds }),
      })
    }
    this._update({ task: active ? { id: active.id, phase: active.phase, transport: active.transport } : null, pending, ...patch })
  }

  snapshot() {
    return this._state
  }

  async *follow(signal) {
    let last
    while (!signal.aborted && !this._lifetime.signal.aborted) {
      if (last !== this._state) {
        last = this._state
        yield last
      } else {
        const { resolve, promise } = Promise.withResolvers()
        this._listeners.add(resolve)
        signal.addEventListener('abort', resolve, { once: true })
        try {
          await promise
        } finally {
          this._listeners.delete(resolve)
          signal.removeEventListener('abort', resolve)
        }
      }
    }
  }

  _guard() {
    if (this._state.recovering || ['syncing', 'decoding'].includes(this._running?.phase) ||
        ['connecting', 'scanning'].includes(this._state.connection)) {
      throw problem('busy')
    }
  }

  async scan() {
    this._guard()
    if (this._state.connection === 'connected') return this._state
    this._setError(null, { connection: 'scanning' })
    try {
      const devices = await this._worker.call('scan', [], 12000)
      this._update({ connection: 'disconnected', scanned: true, devices })
      return this._state
    } catch (error) {
      logger(this.ctx).warn('scan: %s', error.message)
      this._setError('scan-failed', { connection: 'disconnected' })
      throw problem('scan-failed')
    }
  }

  async connect(deviceId) {
    this._guard()
    const address = deviceId.toUpperCase()
    if (this._state.connection === 'connected') {
      if (this._address === address) return this._state
      throw problem('already-connected')
    }
    this._address = address
    this._setError(null, { connection: 'connecting' })
    try {
      const device = await this._worker.call('connect', [address], 65000)
      if (this._address !== address) throw new Error('BLE link closed while connecting')
      this._update({ connection: 'connected', device })
      this._drain()
      return this._state
    } catch (error) {
      logger(this.ctx).warn('connect: %s', error.message)
      this._loseLink('connect-failed')
      throw problem('connect-failed')
    }
  }

  async disconnect() {
    this._guard()
    if (this._state.connection !== 'connected') return this._state
    this._setError(null, { connection: 'connecting' })
    try {
      await this._worker.call('disconnect')
    } catch (error) {
      logger(this.ctx).warn('disconnect: %s', error.message)
      throw problem('disconnect-failed')
    } finally {
      this._loseLink(null)
    }
    return this._state
  }

  startRtc() {
    return this._startRecording('startRtc')
  }

  startSd() {
    return this._startRecording('startSd')
  }

  async _startRecording(method) {
    this._guard()
    if (this._state.connection !== 'connected') throw problem('device-unavailable')
    if (this._recording) throw problem('still-recording')
    if (this._tasks.size >= maxTasks) throw problem('queue-full')
    return this._recordingCommand(method)
  }

  async stopRtc() {
    if (this._recording?.transport !== 'rtc') return true
    return this._recordingCommand('stopRtc')
  }

  async stopSd() {
    if (this._recording?.transport !== 'sd') return true
    return this._recordingCommand('stopSd')
  }

  async _recordingCommand(method) {
    if (this._state.recordingCommand) return true
    this._setError(null, { recordingCommand: method })
    try {
      await this._worker.call(method)
      return true
    } catch (error) {
      logger(this.ctx).warn('%s: %s', method, error.message)
      const fallback = {
        startRtc: 'rtc-unavailable',
        startSd: 'startSd',
        stopRtc: 'stopRtc',
        stopSd: 'stopSd',
      }[method]
      const key = syncError(error.code, fallback)
      this._setError(key)
      throw problem(method, key)
    } finally {
      this._update({ recordingCommand: null })
    }
  }

  async installSpeech() {
    if (this._state.speech.phase !== 'unavailable') return true
    if (this._state.speechInstall === 'installing' || this._state.speechInstall === 'restart-required') return true
    this._setError(null, { speechInstall: 'installing' })
    try {
      const status = await installOfficialSpeech(this.ctx.get('pluginManager'), !!this.ctx.get('speechToText'))
      this._update({ speechInstall: status === 'restart-required' ? status : null })
      return true
    } catch (error) {
      this._update({ speechInstall: 'failed' })
      if (error instanceof ClipSpeechError) throw problem(error.code, error.key, error.args)
      logger(this.ctx).warn('installSpeech: %s', error.message)
      throw problem('speech-install-failed')
    }
  }

  prepareSpeech() {
    try {
      prepareLocalSpeech(this.ctx.get('speechToText'))
      return true
    } catch (error) {
      if (error instanceof ClipSpeechError) throw problem(error.code, error.key, error.args)
      logger(this.ctx).warn('prepareSpeech: %s', error.message)
      throw problem('speech-prepare-failed')
    }
  }

  claimDraft(taskId, sessionId, claimant) {
    const task = this._tasks.get(taskId)
    if (!task) throw problem('task-unavailable')
    if (task.claimant) {
      if (task.claimant === claimant && task.sessionId === sessionId) return true
      throw problem('draft-claimed')
    }
    if (!['recording', 'paused'].includes(task.phase)) {
      throw problem('task-unavailable', 'task-ended')
    }
    task.claimant = claimant
    task.sessionId = sessionId
    return true
  }

  async syncLatest() {
    this._guard()
    if (this._state.connection !== 'connected') {
      throw problem('device-unavailable')
    }
    const address = this._address
    this._setError(null, { recovering: true })
    let id
    try {
      id = await this._worker.call('latestRecording')
      if (!recordingId.test(id)) throw new Error('Invalid Clip recording identity')
      if (this._address !== address) throw problem('link-lost')
    } catch (error) {
      logger(this.ctx).warn('Clip latest recording: %s', error.message)
      throw problem('recovery-failed', syncError(error.details?.clipKey ?? error.code, 'recovery-failed'))
    } finally {
      this._update({ recovering: false })
      this._drain()
    }
    const key = address.replaceAll(':', '') + '-' + id
    if (this._tasks.size >= maxTasks && !this._tasks.has(key)) {
      throw problem('queue-full', 'queue-limit')
    }
    const task = this._tasks.get(key)
    if (task?.phase === 'error') return this.retry(key)
    if (task || this._acknowledged.has(key)) {
      throw problem('already-synced')
    }
    // Explicit recovery has no live recording edge to claim a draft.
    this._onRecording(key, { phase: 'stopped', recordingId: id, transport: 'sd' })
    return true
  }

  async retry(taskId) {
    const task = this._tasks.get(taskId)
    if (task?.phase !== 'error' || !task.retryable) throw problem('task-unavailable', 'retry-unavailable')
    if (!task.recording && task.transport !== 'rtc') {
      if (this._state.connection === 'disconnected') await this.connect(task.address)
      if (this._state.connection !== 'connected' || task.address !== this._address) {
        throw problem('device-unavailable', 'retry-device')
      }
      if (this._tasks.get(taskId) !== task || task.phase !== 'error') {
        throw problem('task-unavailable', 'task-changed')
      }
    }
    task.phase = task.recording ? 'waiting-speech' : 'syncing'
    task.error = undefined
    task.errorArgs = undefined
    this._publish()
    this._drain()
    return true
  }

  async ackResult(taskId) {
    const task = this._tasks.get(taskId)
    if (!task) return true
    if (!['error', 'empty', 'transcript'].includes(task.phase)) {
      throw problem('task-busy')
    }
    // Acknowledge synchronously to keep retry and duplicate acknowledgements from racing with cache removal.
    this._tasks.delete(taskId)
    this._acknowledged.add(taskId)
    if (this._acknowledged.size > 128) this._acknowledged.delete(this._acknowledged.values().next().value)
    this._publish()
    await this._clearCache(task)
    return true
  }

  async _clearCache(task) {
    try {
      await this._worker.clearRecording(task.address, task.recordingId, task.transport)
    } catch (error) {
      logger(this.ctx).warn('Clip cache removal: %s', error.message)
    }
  }

  _loseLink(key) {
    const address = this._address
    this._address = undefined
    for (const task of this._tasks.values()) {
      if (task.address !== address || task === this._running) continue
      if (task.transport === 'rtc' && task.phase === 'syncing') continue
      if (['recording', 'paused', 'syncing'].includes(task.phase)) {
        task.phase = 'error'
        task.error = task.transport === 'rtc' ? 'rtc-interrupted'
          : 'link-lost-sd'
        task.retryable = task.transport !== 'rtc'
      }
    }
    this._recording = undefined
    this._publish({ connection: 'disconnected', device: null, levels: [],
      error: key ? errorCopy(key) : null, errorKey: key })
  }

  _event(event, data) {
    if (event === 'disconnected') {
      if (this._address || data.reason === 'worker-exit') this._loseLink('disconnected')
      return
    }
    if (!this._address || !recordingId.test(data?.recordingId)) return
    const id = this._address.replaceAll(':', '') + '-' + data.recordingId + (data.transport === 'rtc' ? '-rtc' : '')
    if (event === 'levels' && this._recording?.id === id && this._recording.phase === 'recording') {
      this._update({ levels: data.levels })
    } else if (event === 'recording') {
      this._onRecording(id, data)
    } else if (event === 'downloading' && this._running?.id === id) {
      if (data.stage === 'decoding' || data.stage === 'retrying') {
        this._running.phase = data.stage === 'decoding' ? 'decoding' : 'syncing'
        this._publish()
      }
    }
  }

  _onRecording(id, data) {
    if (this._acknowledged.has(id)) return
    let task = this._tasks.get(id)
    if (!task) {
      if (this._tasks.size >= maxTasks) {
        this._setError('queue-limit-event')
        return
      }
      task = {
        id, recordingId: data.recordingId, address: this._address,
        transport: data.transport === 'rtc' ? 'rtc' : 'sd',
        language: speechLanguage(this.ctx.get('speechToText')?.snapshot()),
      }
      this._tasks.set(id, task)
    } else if (['syncing', 'decoding', 'waiting-speech', 'transcribing', 'transcript', 'empty'].includes(task.phase) ||
      (task.transport === 'rtc' && task.phase === 'error')) {
      return
    }
    if (data.phase === 'stopped') {
      if (this._recording === task) this._recording = undefined
      task.phase = 'syncing'
      this._publish({ levels: [] })
      this._drain()
    } else if (data.phase === 'failed') {
      if (this._recording === task) this._recording = undefined
      task.phase = 'error'
      task.retryable = false
      task.error = syncError(data.code, 'rtc-incomplete')
      this._publish({ levels: [] })
      this._drain()
    } else if (data.phase === 'recording' || data.phase === 'paused') {
      task.phase = data.phase
      this._recording = task
      this._publish({ levels: [] })
    }
  }

  _drain() {
    if (this._running || this._state.recovering || this._lifetime.signal.aborted) return
    const job = [...this._tasks.values()].find(task => task.phase === 'waiting-speech' ||
      (task.phase === 'syncing' && (task.transport === 'rtc' ||
        (task.address === this._address && this._state.connection === 'connected'))))
    if (!job) return
    this._running = job
    this._publish()
    this._settled = this._finish(job)
  }

  async _finish(task) {
    try {
      if (!task.recording) {
        if (task.transport === 'rtc') {
          task.phase = 'decoding'
          this._publish()
          task.recording = await this._worker.call('finishRtc', [task.address, task.recordingId])
        } else {
          task.recording = await this._worker.call('downloadAndDecode', [task.recordingId], 225000)
        }
      }
      task.phase = 'waiting-speech'
      this._publish()
      const signal = AbortSignal.any([this._lifetime.signal, AbortSignal.timeout(10 * 60_000)])
      const result = await transcribeClip(this.ctx.get('speechToText'), task.recording, task.language, signal, () => {
        task.phase = 'transcribing'
        this._publish()
      })
      task.text = result.text.trim()
      task.phase = task.text ? 'transcript' : 'empty'
      logger(this.ctx).info('Clip %s %ss WAV: download %sms, decode %sms, SenseVoice %sms',
        task.transport, result.audioSeconds, Math.round(task.recording.downloadMs), Math.round(task.recording.decodeMs),
        Math.round(result.inferenceSeconds * 1000))
      await this._clearCache(task)
    } catch (error) {
      if (this._lifetime.signal.aborted) return
      // DSH does not export Cordis plugin warnings to stdout in every profile.
      // Keep a local diagnostic even when the profile has no log exporter.
      console.warn('[clip] %s %s: %s', task.phase, error.code || 'uncategorized', error.message)
      if (error.code === 'invalid-audio' || error.code === 'ENOENT') task.recording = undefined
      task.error = error instanceof ClipSpeechError ? error.key
        : error.details?.clipKey ?? (task.recording ? 'transcription-failed' : syncError(error.code, 'sync-failed'))
      task.errorArgs = error instanceof ClipSpeechError ? error.args : error.details?.args
      task.retryable = !['too-long', 'decode-failed'].includes(error.code) &&
        (task.transport !== 'rtc' || !error.code?.startsWith('rtc-'))
      task.phase = 'error'
    } finally {
      this._running = undefined
      this._publish()
      this._drain()
    }
  }
}
