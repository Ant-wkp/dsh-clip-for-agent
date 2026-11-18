import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { clipDescriptors } from './contract.js'
import { ClipSpeechError, installOfficialSpeech, prepareLocalSpeech, speechLanguage, speechStatus, transcribeClip } from './speech.js'
import { ClipWorker } from './worker.js'

const packageName = 'dsh-clip-for-agent'
const recordingId = /^[0-9]{14}$/
const problem = (code, message) => new RemoteError('clip/' + code, message, {})
const logger = ctx => ctx.logger('clip')
const maxTasks = 16
const syncMessages = {
  'link-lost': '同步时蓝牙连接中断。重新连接 Clip 后重试。',
  'file-not-ready': 'Clip 尚未完成录音文件写入。请稍后重试。',
  'transfer-timeout': 'Clip 文件传输超时。请将设备靠近主机后重试。',
  'transfer-incomplete': '收到的录音分片不完整或校验失败。请重试。',
  'decode-failed': '录音已下载，但无法解码。请尝试重新录制。',
  'still-recording': 'Clip 正在录音或暂停。请先停录。',
  'device-rejected': 'Clip 拒绝了同步请求。请确认录音已保存后重试。',
  'no-recording': 'Clip 上没有已保存的录音。',
  'rtc-unavailable': '未能开始 RTC 录音。请确认固件支持 RTC，然后重新开始。',
  'rtc-empty': '没有收到 RTC 音频，请重新录制。',
  'rtc-cache': '无法在本机保存 RTC 音频，请检查临时目录。',
  'rtc-incomplete': 'RTC 音频流未完整结束，请重新录制。',
  'rtc-interrupted': 'RTC 录音中途断开，请重新连接后录制。',
}

export default class ClipRemote extends TypertRemoteService {
  static inject = ['typert', 'subprocess']
  _listeners = new Set()
  _state = { connection: 'disconnected', scanned: false, devices: [], device: null,
    speech: { phase: 'unavailable' }, speechInstall: null, task: null, pending: [], levels: [], error: null,
    recovering: false, rtcCommand: null }
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

  _publish(patch) {
    const queued = [...this._tasks.values()].find(task => task.phase === 'syncing')
    const active = this._recording ?? this._running ?? queued
    const pending = []
    for (const task of this._tasks.values()) {
      if (!['error', 'empty', 'transcript'].includes(task.phase)) continue
      pending.push({
        id: task.id, phase: task.phase, retryable: task.retryable ?? false,
        ...(task.sessionId && { sessionId: task.sessionId }),
        ...(task.error && { message: task.error }),
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
      throw problem('busy', 'Clip 正在同步录音或连接设备，请稍后重试。')
    }
  }

  async scan() {
    this._guard()
    if (this._state.connection === 'connected') return this._state
    this._update({ connection: 'scanning', error: null })
    try {
      const devices = await this._worker.call('scan', [], 12000)
      this._update({ connection: 'disconnected', scanned: true, devices })
      return this._state
    } catch (error) {
      const message = '蓝牙扫描失败，请检查主机蓝牙是否开启。'
      logger(this.ctx).warn('scan: %s', error.message)
      this._update({ connection: 'disconnected', error: message })
      throw problem('scan-failed', message)
    }
  }

  async connect(deviceId) {
    this._guard()
    const address = deviceId.toUpperCase()
    if (this._state.connection === 'connected') {
      if (this._address === address) return this._state
      throw problem('already-connected', '请先断开当前 Clip。')
    }
    this._address = address
    this._update({ connection: 'connecting', error: null })
    try {
      const device = await this._worker.call('connect', [address], 65000)
      if (this._address !== address) throw new Error('BLE link closed while connecting')
      this._update({ connection: 'connected', device })
      this._drain()
      return this._state
    } catch (error) {
      const message = 'Clip 连接失败，请检查设备是否可配对。'
      logger(this.ctx).warn('connect: %s', error.message)
      this._loseLink(message)
      throw problem('connect-failed', message)
    }
  }

  async disconnect() {
    this._guard()
    if (this._state.connection !== 'connected') return this._state
    this._update({ connection: 'connecting', error: null })
    try {
      await this._worker.call('disconnect')
    } catch (error) {
      logger(this.ctx).warn('disconnect: %s', error.message)
      throw problem('disconnect-failed', '无法确认 Clip 已断开，请重新连接后重试。')
    } finally {
      this._loseLink(null)
    }
    return this._state
  }

  async startRtc() {
    this._guard()
    if (this._state.connection !== 'connected') throw problem('device-unavailable', '请先连接 Clip。')
    if (this._recording) throw problem('still-recording', syncMessages['still-recording'])
    if (this._tasks.size >= maxTasks) throw problem('queue-full', '请先处理已有 Clip 录音结果。')
    return this._rtcCommand('startRtc')
  }

  async stopRtc() {
    if (this._recording?.transport !== 'rtc') return true
    return this._rtcCommand('stopRtc')
  }

  async _rtcCommand(method) {
    if (this._state.rtcCommand) return true
    this._update({ rtcCommand: method, error: null })
    try {
      await this._worker.call(method)
      return true
    } catch (error) {
      logger(this.ctx).warn('%s: %s', method, error.message)
      const fallback = method === 'startRtc' ? syncMessages['rtc-unavailable'] : '无法停止 RTC 录音，请重试。'
      throw problem(method, syncMessages[error.code] ?? fallback)
    } finally {
      this._update({ rtcCommand: null })
    }
  }

  async installSpeech() {
    if (this._state.speech.phase !== 'unavailable') return true
    if (this._state.speechInstall === 'installing' || this._state.speechInstall === 'restart-required') return true
    this._update({ speechInstall: 'installing', error: null })
    try {
      const status = await installOfficialSpeech(this.ctx.get('pluginManager'), !!this.ctx.get('speechToText'))
      this._update({ speechInstall: status === 'restart-required' ? status : null })
      return true
    } catch (error) {
      this._update({ speechInstall: 'failed' })
      if (error instanceof ClipSpeechError) throw problem(error.code, error.message)
      logger(this.ctx).warn('installSpeech: %s', error.message)
      throw problem('speech-install-failed', '官方转写安装失败，请重试。')
    }
  }

  prepareSpeech() {
    try {
      prepareLocalSpeech(this.ctx.get('speechToText'))
      return true
    } catch (error) {
      if (error instanceof ClipSpeechError) throw problem(error.code, error.message)
      logger(this.ctx).warn('prepareSpeech: %s', error.message)
      throw problem('speech-prepare-failed', 'SenseVoice 准备失败，请重试。')
    }
  }

  claimDraft(taskId, sessionId, claimant) {
    const task = this._tasks.get(taskId)
    if (!task) throw problem('task-unavailable', '录音任务已结束。')
    if (task.claimant) {
      if (task.claimant === claimant && task.sessionId === sessionId) return true
      throw problem('draft-claimed', '这条录音已绑定到另一个已打开的聊天。')
    }
    if (!['recording', 'paused'].includes(task.phase)) {
      throw problem('task-unavailable', '录音已结束，可在聊天中手动插入结果。')
    }
    task.claimant = claimant
    task.sessionId = sessionId
    return true
  }

  async syncLatest() {
    this._guard()
    if (this._state.connection !== 'connected') {
      throw problem('device-unavailable', '请先连接 Clip。')
    }
    const address = this._address
    this._update({ recovering: true, error: null })
    let id
    try {
      id = await this._worker.call('latestRecording')
      if (!recordingId.test(id)) throw new Error('Invalid Clip recording identity')
      if (this._address !== address) throw problem('link-lost', syncMessages['link-lost'])
    } catch (error) {
      logger(this.ctx).warn('Clip latest recording: %s', error.message)
      throw problem('recovery-failed', syncMessages[error.code] || '暂时无法读取 Clip 录音列表，请重试。')
    } finally {
      this._update({ recovering: false })
      this._drain()
    }
    const key = address.replaceAll(':', '') + '-' + id
    if (this._tasks.size >= maxTasks && !this._tasks.has(key)) {
      throw problem('queue-full', 'Clip 待处理录音已达上限，请先清理已有结果。')
    }
    const task = this._tasks.get(key)
    if (task?.phase === 'error') return this.retry(key)
    if (task || this._acknowledged.has(key)) {
      throw problem('already-synced', '这条录音已在本次连接中处理。')
    }
    // Explicit recovery has no live recording edge to claim a draft.
    this._onRecording(key, { phase: 'stopped', recordingId: id, transport: 'sd' })
    return true
  }

  async retry(taskId) {
    const task = this._tasks.get(taskId)
    if (task?.phase !== 'error' || !task.retryable) throw problem('task-unavailable', '这条录音不能重试。')
    if (!task.recording && task.transport !== 'rtc') {
      if (this._state.connection === 'disconnected') await this.connect(task.address)
      if (this._state.connection !== 'connected' || task.address !== this._address) {
        throw problem('device-unavailable', '请先连接录制这条语音的 Clip。')
      }
      if (this._tasks.get(taskId) !== task || task.phase !== 'error') {
        throw problem('task-unavailable', '录音任务状态已变化。')
      }
    }
    task.phase = task.recording ? 'waiting-speech' : 'syncing'
    task.error = undefined
    this._publish()
    this._drain()
    return true
  }

  async ackResult(taskId) {
    const task = this._tasks.get(taskId)
    if (!task) return true
    if (!['error', 'empty', 'transcript'].includes(task.phase)) {
      throw problem('task-busy', '录音仍在处理。')
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

  _loseLink(message) {
    const address = this._address
    this._address = undefined
    for (const task of this._tasks.values()) {
      if (task.address !== address || task === this._running) continue
      if (task.transport === 'rtc' && task.phase === 'syncing') continue
      if (['recording', 'paused', 'syncing'].includes(task.phase)) {
        task.phase = 'error'
        task.error = task.transport === 'rtc' ? syncMessages['rtc-interrupted']
          : 'Clip 连接已断开，重新连接后可以同步录音。'
        task.retryable = task.transport !== 'rtc'
      }
    }
    this._recording = undefined
    this._publish({ connection: 'disconnected', device: null, levels: [], error: message })
  }

  _event(event, data) {
    if (event === 'disconnected') {
      if (this._address || data.reason === 'worker-exit') this._loseLink('与 Clip 的连接已断开。')
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
        this._update({ error: 'Clip 待处理录音已达上限，请先处理已有结果。' })
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
      task.error = syncMessages[data.code] ?? syncMessages['rtc-incomplete']
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
      task.error = error instanceof ClipSpeechError || error.code?.startsWith('clip/')
        ? error.message : task.recording ? 'SenseVoice 转写失败，可以重试。'
          : syncMessages[error.code] || '录音同步失败，可以重试。'
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
