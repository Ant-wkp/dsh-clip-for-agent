window.__ModuleLoader__.load({
  id: 'dsh-clip-for-agent',

  factory(require) {
    const { createElement: h, useLayoutEffect, useRef, useSyncExternalStore } = require('react')
    const {
      Button, IconChevronLeftOutlineMedium, IconCloseOutlineRegular, IconMicrophoneOutlineRegular,
      IconSearchOutlineRegular, IconStopFillRegular, StateDot, Tooltip,
    } = require('@deepseek-ai/dsh-client-ui-primitives')
    function clipDescriptors() {
      const packageName = 'dsh-clip-for-agent'
      const codec = (name, valid) => ({
        mode: 'strict',
        typeSymbol: packageName + '#' + name,
        create: () => ({
          parse(value) {
            if (!valid(value)) throw new TypeError('Invalid ' + name)
            return value
          },
        }),
      })
      const deviceId = codec('DeviceId', value => typeof value === 'string' && /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(value))
      const taskId = codec('TaskId', value => typeof value === 'string' && /^[0-9A-F]{12}-\d{14}(?:-rtc)?$/.test(value))
      const sessionId = codec('SessionId', value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f]/.test(value))
      const claimant = codec('Claimant', value => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value))
      const success = codec('Success', value => value === true)
      const snapshot = codec('Snapshot', value => value && typeof value === 'object' &&
        ['disconnected', 'scanning', 'connecting', 'connected'].includes(value.connection) &&
        Array.isArray(value.devices) && Array.isArray(value.pending) && Array.isArray(value.levels))
      return [
        ['scan', [], snapshot],
        ['connect', [['deviceId', deviceId]], snapshot],
        ['disconnect', [], snapshot],
        ['startRtc', [], success],
        ['stopRtc', [], success],
        ['startSd', [], success],
        ['stopSd', [], success],
        ['snapshot', [], snapshot],
        ['follow', [], snapshot],
        ['installSpeech', [], success],
        ['prepareSpeech', [], success],
        ['claimDraft', [['taskId', taskId], ['sessionId', sessionId], ['claimant', claimant]], success],
        ['syncLatest', [], success],
        ['retry', [['taskId', taskId]], success],
        ['ackResult', [['taskId', taskId]], success],
      ].map(([method, inputs, result]) => ({
        id: packageName + '#clip/' + method,
        namespace: 'clip',
        service: 'clipRemote',
        method,
        invocation: { kind: 'direct' },
        parameters: inputs.map(([name, codec]) => ({ name, wire: name, source: 'json', codec })),
        result,
        ...(method === 'follow' && { mode: 'stream', cancellation: { parameter: 'signal' } }),
      }))
    }
    const panelId = 'clip-for-agent'
    const activitySlot = 'conversation.input.activity'
    const clipMessages = {
      "zh": {
        "recordingWaveform": "Clip 正在输入",
        "demoText": "这是一条来自 Clip 的模拟语音转写。",
        "panelLabel": "Clip 设备面板",
        "intro": "通过本机蓝牙连接 reSpeaker Clip，支持 RTC 实时录音和 SD 录音。",
        "backToChat": "返回聊天",
        "scanning": "扫描中…",
        "scanDemo": "扫描模拟设备",
        "scan": "扫描设备",
        "devices": "设备",
        "demoDevice": "reSpeaker Clip（模拟）",
        "demoConnected": "模拟 Clip 已连接",
        "disconnected": "未连接",
        "disconnectDemo": "断开模拟设备",
        "disconnect": "断开",
        "connectDemo": "连接模拟设备",
        "connect": "配对连接",
        "searching": "正在搜索附近的 Clip…",
        "noDevices": "未发现 Clip。请让设备进入可配对状态后重新扫描。",
        "scanPrompt": "点击扫描查找附近的 Clip。",
        "speech": "语音转写",
        "speechReady": "已就绪",
        "speechStandby": "已安装",
        "speechUnprepared": "需要下载模型",
        "speechChecking": "正在检查模型…",
        "speechDownloading": "正在下载模型…",
        "speechLoading": "正在加载模型…",
        "speechFailed": "安装失败",
        "speechCancelled": "安装已取消",
        "speechUnavailable": "官方转写未启用",
        "installSpeech": "安装官方转写",
        "retryInstallSpeech": "重试安装官方转写",
        "retryModel": "重试安装",
        "installModel": "安装 SenseVoice 模型",
        "installingSpeech": "正在安装官方转写…",
        "restartSpeech": "官方转写已安装，请重启 DSH 后继续。",
        "pendingTranscripts": "待插入转写",
        "recordingResults": "录音结果",
        "recordingMode": "录音模式",
        "rtcMode": "RTC 实时音频",
        "sdMode": "SD 录音（停录后同步）",
        "findingLatest": "正在查找…",
        "syncLatest": "同步最近 SD 录音",
        "recordingOrPaused": "Clip 正在录音或暂停",
        "processing": "正在处理录音…",
        "emptyTranscript": "未识别到语音",
        "recordingFailed": "录音处理失败",
        "insertOriginalChat": "返回原聊天可插入",
        "insertOpenChat": "打开聊天后可插入",
        "retry": "重试",
        "clear": "清除",
        "noResults": "暂无结果",
        "voiceInput": "Clip 语音输入",
        "startDemo": "开始 Clip 录音（模拟）",
        "stopDemo": "停止 Clip 录音（模拟）",
        "transcriptReady": "转写完成，可插入草稿",
        "syncing": "正在同步…",
        "decoding": "正在解码…",
        "transcribing": "正在转写…",
        "paused": "Clip 录音已暂停",
        "waitingSpeech": "正在准备语音转写…",
        "clipRecordingFailed": "Clip 录音处理失败",
        "clearResult": "清除 Clip 结果",
        "cancelRecording": "取消 Clip 录音",
        "insert": "插入",
        "connectedBattery": "已连接 · 电量 {battery}%",
        "startRecording": "开始 {mode} 录音",
        "stopRecording": "停止 {mode} 录音",
        "startClipRecording": "开始 Clip {mode} 录音",
        "stopClipRecording": "停止 Clip {mode} 录音",
        "error.status-unavailable": "无法获取 Clip 状态。",
        "error.operation-failed": "无法执行 Clip 操作。",
        "error.link-lost": "同步时蓝牙连接中断。重新连接 Clip 后重试。",
        "error.file-not-ready": "Clip 尚未完成录音文件写入。请稍后重试。",
        "error.transfer-timeout": "Clip 文件传输超时。请将设备靠近主机后重试。",
        "error.transfer-incomplete": "收到的录音分片不完整或校验失败。请重试。",
        "error.decode-failed": "录音已下载，但无法解码。请尝试重新录制。",
        "error.still-recording": "Clip 正在录音或暂停。请先停录。",
        "error.device-rejected": "Clip 拒绝了同步请求。请确认录音已保存后重试。",
        "error.no-recording": "Clip 上没有已保存的录音。",
        "error.rtc-unavailable": "未能开始 RTC 录音。请确认固件支持 RTC，然后重新开始。",
        "error.rtc-empty": "没有收到 RTC 音频，请重新录制。",
        "error.rtc-cache": "无法在本机保存 RTC 音频，请检查临时目录。",
        "error.rtc-incomplete": "RTC 音频流未完整结束，请重新录制。",
        "error.rtc-interrupted": "RTC 录音中途断开，请重新连接后录制。",
        "error.busy": "Clip 正在同步录音或连接设备，请稍后重试。",
        "error.scan-failed": "蓝牙扫描失败，请检查主机蓝牙是否开启。",
        "error.already-connected": "请先断开当前 Clip。",
        "error.connect-failed": "Clip 连接失败，请检查设备是否可配对。",
        "error.disconnect-failed": "无法确认 Clip 已断开，请重新连接后重试。",
        "error.device-unavailable": "请先连接 Clip。",
        "error.queue-full": "请先处理已有 Clip 录音结果。",
        "error.startSd": "无法开始 SD 录音，请检查 Clip 上的 SD 卡和设备状态。",
        "error.stopRtc": "无法停止 RTC 录音，请重试。",
        "error.stopSd": "无法停止 SD 录音，请重试。",
        "error.speech-install-failed": "官方转写安装失败，请重试。",
        "error.speech-prepare-failed": "SenseVoice 准备失败，请重试。",
        "error.task-unavailable": "录音任务已结束。",
        "error.draft-claimed": "这条录音已绑定到另一个已打开的聊天。",
        "error.task-ended": "录音已结束，可在聊天中手动插入结果。",
        "error.recovery-failed": "暂时无法读取 Clip 录音列表，请重试。",
        "error.queue-limit": "Clip 待处理录音已达上限，请先清理已有结果。",
        "error.queue-limit-event": "Clip 待处理录音已达上限，请先处理已有结果。",
        "error.already-synced": "这条录音已在本次连接中处理。",
        "error.retry-unavailable": "这条录音不能重试。",
        "error.retry-device": "请先连接录制这条语音的 Clip。",
        "error.task-changed": "录音任务状态已变化。",
        "error.task-busy": "录音仍在处理。",
        "error.link-lost-sd": "Clip 连接已断开，重新连接后可以同步录音。",
        "error.disconnected": "与 Clip 的连接已断开。",
        "error.transcription-failed": "SenseVoice 转写失败，可以重试。",
        "error.sync-failed": "录音同步失败，可以重试。",
        "error.speech-unavailable": "请在 Clip 面板安装或启用官方转写。",
        "error.speech-prepare": "SenseVoice 尚未就绪。请在 Clip 面板安装模型后重试。",
        "error.speech-manager-unavailable": "当前 DSH 配置未启用插件管理。",
        "error.speech-component-failed": "官方转写组件未能启动。请检查 DSH 插件配置后重试。",
        "error.speech-install-unavailable": "当前 DSH 未提供可安装的官方转写组件。",
        "error.too-long": "这段录音超过 120 秒语音输入上限。",
        "error.invalid-audio": "本地录音不完整，请重新同步。",
        "error.speech-install-incomplete": "官方转写安装未完成（{reason}）。请重试或检查 DSH 插件配置。"
      },
      "en": {
        "recordingWaveform": "Clip voice input in progress",
        "demoText": "This is a sample transcript from Clip.",
        "panelLabel": "Clip device panel",
        "intro": "Connect reSpeaker Clip over Bluetooth and record in live RTC or SD mode.",
        "backToChat": "Back to chat",
        "scanning": "Scanning…",
        "scanDemo": "Scan for demo devices",
        "scan": "Scan for devices",
        "devices": "Devices",
        "demoDevice": "reSpeaker Clip (demo)",
        "demoConnected": "Demo Clip connected",
        "disconnected": "Disconnected",
        "disconnectDemo": "Disconnect demo device",
        "disconnect": "Disconnect",
        "connectDemo": "Connect demo device",
        "connect": "Pair and connect",
        "searching": "Searching for nearby Clip devices…",
        "noDevices": "No Clip found. Put your Clip in pairing mode and scan again.",
        "scanPrompt": "Scan to find nearby Clip devices.",
        "speech": "Speech recognition",
        "speechReady": "Ready",
        "speechStandby": "Installed",
        "speechUnprepared": "Model download required",
        "speechChecking": "Checking the model…",
        "speechDownloading": "Downloading the model…",
        "speechLoading": "Loading the model…",
        "speechFailed": "Installation failed",
        "speechCancelled": "Installation canceled",
        "speechUnavailable": "Official speech recognition is disabled",
        "installSpeech": "Install official speech recognition",
        "retryInstallSpeech": "Retry installing official speech recognition",
        "retryModel": "Retry installation",
        "installModel": "Install the SenseVoice model",
        "installingSpeech": "Installing official speech recognition…",
        "restartSpeech": "Official speech recognition is installed. Restart DSH to continue.",
        "pendingTranscripts": "Transcripts ready to insert",
        "recordingResults": "Recording results",
        "recordingMode": "Recording mode",
        "rtcMode": "RTC live audio",
        "sdMode": "SD recording (sync on stop)",
        "findingLatest": "Finding the latest recording…",
        "syncLatest": "Sync latest SD recording",
        "recordingOrPaused": "Clip recording is active or paused",
        "processing": "Processing the recording…",
        "emptyTranscript": "No speech detected",
        "recordingFailed": "Could not process the recording",
        "insertOriginalChat": "Return to the original chat to insert",
        "insertOpenChat": "Open a chat to insert",
        "retry": "Retry",
        "clear": "Clear",
        "noResults": "No results yet",
        "voiceInput": "Clip voice input",
        "startDemo": "Start Clip recording (demo)",
        "stopDemo": "Stop Clip recording (demo)",
        "transcriptReady": "Transcript ready to insert",
        "syncing": "Syncing…",
        "decoding": "Decoding…",
        "transcribing": "Transcribing…",
        "paused": "Clip recording paused",
        "waitingSpeech": "Preparing speech recognition…",
        "clipRecordingFailed": "Could not process the Clip recording",
        "clearResult": "Clear Clip result",
        "cancelRecording": "Cancel Clip recording",
        "insert": "Insert",
        "connectedBattery": "Connected · {battery}% battery",
        "startRecording": "Start {mode} recording",
        "stopRecording": "Stop {mode} recording",
        "startClipRecording": "Start Clip {mode} recording",
        "stopClipRecording": "Stop Clip {mode} recording",
        "error.status-unavailable": "Could not get the Clip status.",
        "error.operation-failed": "Could not complete the Clip action.",
        "error.link-lost": "Bluetooth disconnected during sync. Reconnect Clip and try again.",
        "error.file-not-ready": "Clip is still saving the recording. Try again shortly.",
        "error.transfer-timeout": "The file transfer timed out. Move Clip closer to the host and try again.",
        "error.transfer-incomplete": "The recording arrived incomplete or failed its integrity check. Try again.",
        "error.decode-failed": "Could not decode the downloaded recording. Record it again.",
        "error.still-recording": "Clip is recording or paused. Stop the recording first.",
        "error.device-rejected": "Clip rejected the sync request. Confirm the recording was saved and try again.",
        "error.no-recording": "There are no saved recordings on Clip.",
        "error.rtc-unavailable": "Could not start RTC recording. Confirm the firmware supports RTC and try again.",
        "error.rtc-empty": "No RTC audio was received. Record it again.",
        "error.rtc-cache": "Could not save RTC audio locally. Check the temporary directory.",
        "error.rtc-incomplete": "The RTC audio stream ended early. Record it again.",
        "error.rtc-interrupted": "Clip disconnected during RTC recording. Reconnect it and record again.",
        "error.busy": "Clip is syncing or connecting. Try again shortly.",
        "error.scan-failed": "Bluetooth scan failed. Check that Bluetooth is enabled on the host.",
        "error.already-connected": "Disconnect the current Clip first.",
        "error.connect-failed": "Could not connect to Clip. Check that it is in pairing mode.",
        "error.disconnect-failed": "Could not confirm that Clip disconnected. Reconnect it and try again.",
        "error.device-unavailable": "Connect a Clip first.",
        "error.queue-full": "Handle the existing Clip results first.",
        "error.startSd": "Could not start SD recording. Check the SD card and device status.",
        "error.stopRtc": "Could not stop RTC recording. Try again.",
        "error.stopSd": "Could not stop SD recording. Try again.",
        "error.speech-install-failed": "Could not install official speech recognition. Try again.",
        "error.speech-prepare-failed": "Could not prepare SenseVoice. Try again.",
        "error.task-unavailable": "The recording task has ended.",
        "error.draft-claimed": "This recording is already linked to another open chat.",
        "error.task-ended": "Recording has ended. You can insert the result manually in chat.",
        "error.recovery-failed": "Could not read the Clip recording list. Try again.",
        "error.queue-limit": "Clip has reached its recording limit. Clear existing results first.",
        "error.queue-limit-event": "Clip has reached its recording limit. Handle the existing results first.",
        "error.already-synced": "This recording has already been processed during this connection.",
        "error.retry-unavailable": "This recording cannot be retried.",
        "error.retry-device": "Connect the Clip that made this recording first.",
        "error.task-changed": "The recording task has changed.",
        "error.task-busy": "The recording is still processing.",
        "error.link-lost-sd": "Clip disconnected. Reconnect it to sync the recording.",
        "error.disconnected": "Clip disconnected.",
        "error.transcription-failed": "SenseVoice transcription failed. You can retry.",
        "error.sync-failed": "Recording sync failed. You can retry.",
        "error.speech-unavailable": "Install or enable official speech recognition in the Clip panel.",
        "error.speech-prepare": "SenseVoice is not ready. Install the model in the Clip panel and try again.",
        "error.speech-manager-unavailable": "Plugin management is disabled in this DSH configuration.",
        "error.speech-component-failed": "Official speech recognition could not start. Check the DSH plugin settings and try again.",
        "error.speech-install-unavailable": "This DSH installation has no official speech recognition component available.",
        "error.too-long": "The recording exceeds the 120-second voice input limit.",
        "error.invalid-audio": "The local recording is incomplete. Sync it again.",
        "error.speech-install-incomplete": "Official speech recognition installation did not finish ({reason}). Retry or check the DSH plugin settings."
      }
    }
    const localeNamespace = 'dsh-clip-for-agent'
    const recordingModeKey = 'dsh-clip-for-agent.recording-mode'
    const modeLabel = (mode) => mode === 'sd' ? 'SD' : 'RTC'
    const panelStyles = `
      .clip-panel {
        --clip-panel-inset: clamp(24px, 4vw, 48px);
        height: 100%; min-width: 0; min-height: 0; overflow: auto;
        color: var(--dsw-alias-label-primary);
      }
      @media (width <= 767px) { .clip-panel { --clip-panel-inset: 20px; } }
      .clip-panel-content {
        box-sizing: content-box; max-width: 960px; margin-inline: auto;
        padding: 0 var(--clip-panel-inset) 48px;
        display: flex; flex-direction: column; gap: 32px;
      }
      .clip-panel-header {
        display: flex; align-items: flex-start; justify-content: space-between;
        flex-wrap: wrap; gap: 16px; padding-top: 28px;
      }
      [data-platform="darwin"] .clip-panel-header {
        padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px));
      }
      .clip-panel-header h1 { margin: 0; font-size: 20px; line-height: 28px; font-weight: 500; }
      .clip-panel-intro { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
      .clip-panel-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
      .clip-panel .clip-panel-action { height: 32px; padding-inline: 12px; border-radius: var(--dsw-radius-lg); }
      .clip-panel-group { display: flex; flex-direction: column; gap: 8px; }
      .clip-panel-group h2 { margin: 0; font-size: 14px; line-height: 22px; font-weight: 500; }
      .clip-panel-list { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
      .clip-panel-row {
        display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px;
        min-width: 0; margin-inline: -8px; padding: 8px; border-radius: var(--dsw-radius-xl);
      }
      .clip-panel-icon {
        display: grid; place-items: center; flex: none; width: 48px; height: 48px;
        border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-lg);
        color: var(--dsw-alias-label-secondary);
      }
      .clip-panel-row-body { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 120px; }
      .clip-panel-row-name { font-size: 14px; line-height: 20px; font-weight: 500; overflow-wrap: anywhere; }
      .clip-panel-note { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }
      .clip-panel-row .clip-panel-action { margin-inline-start: auto; }
      .clip-panel-mode { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; }
      .clip-panel-mode select {
        font: inherit; color: inherit; padding: 4px 8px; border-radius: var(--dsw-radius-lg);
        background: var(--dsw-specific-selector); border: 1px solid var(--dsw-alias-border-l3);
      }
    `
    const activityStyles = `
      .clip-voice-idle { display: inline-flex; flex: none; }
      .clip-voice-idle .clip-voice-trigger { flex: none; width: 28px; padding: 0; }
      .clip-voice-row { display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; min-height: 34px; }
      .clip-voice-row .clip-voice-round {
        flex: none; width: 32px; height: 32px; padding: 0; border-radius: 50%;
        corner-shape: round; background: var(--dsw-specific-selector);
      }
      @media (hover: hover) {
        .clip-voice-row .clip-voice-round:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-solid); }
      }
      .clip-voice-waveform { display: block; flex: 1; width: 0; min-width: 24px; height: 24px; color: var(--dsw-alias-label-secondary); }
      .clip-voice-message { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .clip-voice-message-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .clip-voice-insert { flex: none; }
    `

    function Waveform({ readAmplitude, label }) {
      const svg = useRef(null)
      useLayoutEffect(() => {
        const strokes = svg.current.querySelectorAll('line')
        const history = new Float32Array(strokes.length)
        let lastSample = -Infinity
        let animation

        function tick(now) {
          if (now - lastSample >= 50) {
            lastSample = now
            history.copyWithin(0, 1)
            history[history.length - 1] = readAmplitude()
            strokes.forEach((stroke, index) => {
              const halfHeight = 1 + Math.min(1, history[index] * 5) * 17
              stroke.setAttribute('y1', 20 - halfHeight)
              stroke.setAttribute('y2', 20 + halfHeight)
            })
          }
          animation = window.requestAnimationFrame(tick)
        }

        animation = window.requestAnimationFrame(tick)
        return () => window.cancelAnimationFrame(animation)
      }, [readAmplitude])

      return h('svg', {
        ref: svg, className: 'clip-voice-waveform', viewBox: '0 0 640 40',
        preserveAspectRatio: 'none', role: 'img', 'aria-label': label,
      }, Array.from({ length: 80 }, (_, index) => {
        const x = index * 8 + 4
        return h('line', {
          key: index, x1: x, x2: x, y1: 19, y2: 21, stroke: 'currentColor',
          strokeWidth: 3, strokeLinecap: 'round', opacity: 0.25 + index / 120,
        })
      }))
    }

    function createDemoSource(enabled, window, t) {
      let nextId = 0
      let timer
      let levelTimer
      let amplitude = 0
      let targetSession
      let state = { enabled, scanned: false, connection: 'disconnected', task: null, pending: [] }
      const listeners = new Set()

      function update(patch) {
        const previous = state
        const next = { ...state, ...patch }
        state = next
        for (const listener of listeners) listener(next, previous)
      }

      function ackResult(id) {
        if (!state.pending.some(item => item.id === id)) return
        update({ pending: state.pending.filter(item => item.id !== id) })
      }

      function cancel() {
        window.clearTimeout(timer)
        window.clearInterval(levelTimer)
        amplitude = 0
        if (state.task) update({ task: null })
      }

      return {
        getSnapshot: () => state,
        readAmplitude: () => amplitude,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        ackResult,
        cancel,
        bindSession(_taskId, sessionId) {
          targetSession ??= sessionId
          return true
        },
        scan() {
          if (enabled) update({ scanned: true })
        },
        connect() {
          if (enabled && state.scanned) update({ connection: 'connected' })
        },
        disconnect() {
          cancel()
          update({ connection: 'disconnected' })
        },
        start() {
          if (state.connection !== 'connected' || state.task) return
          targetSession = undefined
          const id = ++nextId
          update({ task: { id, phase: 'recording' } })
          let frame = 0
          levelTimer = window.setInterval(() => {
            const syllable = Math.abs(Math.sin(frame * 0.61))
            const phrase = (Math.sin(frame * 0.13) + 1) / 2
            amplitude = phrase < 0.17 ? 0 : 0.22 * syllable * phrase
            frame += 1
          }, 50)
        },
        stop() {
          if (state.task?.phase !== 'recording') return
          window.clearInterval(levelTimer)
          amplitude = 0
          const { id } = state.task
          update({ task: { id, phase: 'syncing' } })
          timer = window.setTimeout(() => {
            update({ task: { id, phase: 'transcribing' } })
            timer = window.setTimeout(() => {
              const result = { id, text: t('demoText'), sessionId: targetSession }
              update({ task: null, pending: [...state.pending, result] })
            }, 700)
          }, 500)
        },
        dispose() {
          window.clearTimeout(timer)
          window.clearInterval(levelTimer)
          listeners.clear()
        },
      }
    }

    function createRemoteSource(ctx) {
      let recordingMode = 'rtc'
      try {
        if (window.localStorage.getItem(recordingModeKey) === 'sd') recordingMode = 'sd'
      } catch {}
      let state = { loaded: false, scanned: false, connection: 'disconnected', devices: [], device: null,
        speech: { phase: 'unavailable' }, task: null, pending: [], levels: [], error: null, recordingMode }
      const claimant = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
      let disposed = false
      const listeners = new Set()
      function update(patch) {
        if (disposed) return
        const previous = state
        state = { ...state, ...patch }
        for (const listener of listeners) listener(state, previous)
      }
      const stream = ctx.remote.$stream({
        name: 'Clip',
        open: signal => ctx.remote.clip.follow(signal),
        ended: () => new Error('Clip status stream disconnected'),
        carrierFailed: () => update({ error: { key: 'status-unavailable' } }),
      })
      const observing = (async () => {
        try {
          for await (const item of stream) {
            update({
              ...item.value, loaded: true,
              error: item.value.errorKey ? { key: item.value.errorKey } : null,
            })
            item.accept()
          }
        } catch {
          update({ error: { key: 'status-unavailable' } })
        }
      })()
      async function invoke(method, ...args) {
        try {
          const response = await ctx.remote.clip[method](...args)
          if (!response.ok && method !== 'claimDraft') {
            const { clipKey, args } = response.error.details ?? {}
            update({ error: { key: clipKey ?? 'operation-failed', args } })
          }
          return response.ok
        } catch {
          if (method !== 'claimDraft') update({ error: { key: 'operation-failed' } })
          return false
        }
      }
      return {
        getSnapshot: () => state,
        readAmplitude: () => Math.max(0, ...state.levels) / 40,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        bindSession: (taskId, sessionId) => invoke('claimDraft', taskId, sessionId, claimant),
        installSpeech: () => invoke('installSpeech'),
        prepareSpeech: () => invoke('prepareSpeech'),
        scan: () => invoke('scan'),
        connect: id => invoke('connect', id),
        disconnect: () => invoke('disconnect'),
        selectRecordingMode(mode) {
          if (mode !== 'rtc' && mode !== 'sd') return
          try { window.localStorage.setItem(recordingModeKey, mode) } catch {}
          update({ recordingMode: mode })
        },
        start: () => invoke(state.recordingMode === 'sd' ? 'startSd' : 'startRtc'),
        stop: () => invoke(state.task?.transport === 'sd' ? 'stopSd' : 'stopRtc'),
        retry: id => invoke('retry', id),
        syncLatest: () => invoke('syncLatest'),
        ackResult: id => invoke('ackResult', id),
        async dispose() {
          disposed = true
          listeners.clear()
          await stream.dispose()
          await observing
        },
      }
    }

    // Capture only a live start edge while the current chat is visible and writable.
    // The stored anchor becomes invalid if the draft changes or the user leaves this chat.
    function bindDraft(source, sessionId, inputActions, canEdit) {
      const anchors = new Map()
      const invalidate = () => anchors.clear()
      const unsubscribe = source.subscribe((state, previous) => {
        const task = state.task
        if (previous.loaded !== false && task?.phase === 'recording' && task.id !== previous.task?.id && canEdit()) {
          anchors.set(task.id, {
            span: inputActions.captureInsertion(),
            claim: Promise.resolve(source.bindSession(task.id, sessionId)),
          })
        }
        for (const result of state.pending) {
          const anchor = anchors.get(result.id)
          if (!anchor || anchor.resolving) continue
          if (!result.text) {
            if (result.phase === 'empty') anchors.delete(result.id)
            continue
          }
          anchor.resolving = true
          void anchor.claim.then(claimed => {
            if (anchors.get(result.id) !== anchor) return
            anchors.delete(result.id)
            if (claimed && result.sessionId === sessionId && canEdit() &&
                source.getSnapshot().pending.some(item => item.id === result.id) &&
                inputActions.insertText(result.text, anchor.span)) source.ackResult(result.id)
          })
        }
      })
      return {
        invalidate,
        dispose() {
          unsubscribe()
          invalidate()
        },
      }
    }

    function ClipIcon({ size = 18 }) {
      return h(IconMicrophoneOutlineRegular, { size, 'aria-hidden': true })
    }

    function registerUi(ctx, demo) {
      const locale = ctx.locale
      const t = locale.bind(localeNamespace)
      ctx.effect(() => locale.register(localeNamespace, clipMessages))

      const subscribeLocale = listener => locale.subscribe(listener)
      const getLocaleSnapshot = () => locale.getSnapshot()
      function useLocale() {
        useSyncExternalStore(subscribeLocale, getLocaleSnapshot)
      }

      function errorMessage(key, args, fallback) {
        return key && Object.hasOwn(clipMessages.en, 'error.' + key)
          ? t('error.' + key, args) : fallback
      }

      const source = demo ? createDemoSource(true, window, t) : createRemoteSource(ctx)
      const panelInfo = ctx.layout.panelInfo
      const conversationVisible = () => panelInfo.getSnapshot().activePanelId === null
      const canEdit = () => conversationVisible() && !document.hidden && document.hasFocus()

      function ClipPanel() {
        useLocale()
        const { loaded, scanned, connection, pending, devices, device, error, speech, speechInstall,
          task, recovering, recordingCommand, recordingMode } = useSyncExternalStore(source.subscribe, source.getSnapshot)
        const busy = connection === 'scanning' || connection === 'connecting'
        const connected = connection === 'connected'
        const isRecording = ['recording', 'paused'].includes(task?.phase)
        const currentMode = modeLabel(isRecording ? task.transport : recordingMode)
        const speechPhase = loaded ? speech?.phase : 'checking'
        const speechBusy = ['checking', 'downloading', 'loading', 'waking', 'cancelling'].includes(speechPhase)
        const speechLabels = {
          ready: t('speechReady'), standby: t('speechStandby'), unprepared: t('speechUnprepared'),
          checking: t('speechChecking'), downloading: t('speechDownloading'), loading: t('speechLoading'),
          waking: t('speechLoading'), failed: t('speechFailed'), cancelled: t('speechCancelled'), unavailable: t('speechUnavailable'),
        }
        const percentage = speech?.totalBytes > 0
          ? ' ' + Math.min(100, Math.floor(speech.completedBytes * 100 / speech.totalBytes)) + '%' : ''

        const speechAction = speechPhase === 'unavailable'
          ? (speechInstall === 'installing' || speechInstall === 'restart-required' ? null : {
            label: speechInstall === 'failed' ? t('retryInstallSpeech') : t('installSpeech'), run: source.installSpeech,
          })
          : ['unprepared', 'failed', 'cancelled'].includes(speechPhase)
            ? { label: speechPhase === 'failed' ? t('retryModel') : t('installModel'), run: source.prepareSpeech }
            : null

        const rows = demo
          ? (scanned ? [{ id: 'demo', name: t('demoDevice') }] : [])
          : [...devices, ...(device && !devices.some(item => item.id === device.id) ? [device] : [])]
        return h('section', { className: 'clip-panel', 'aria-label': t('panelLabel') },
          h('div', { className: 'clip-panel-content' },
            h('header', { className: 'clip-panel-header', 'data-window-drag': true },
              h('div', null,
                h('h1', null, 'Clip'),
                h('p', { className: 'clip-panel-intro' }, t('intro'))),
              h('div', { className: 'clip-panel-actions' },
                h(Button, {
                  type: 'button', size: 'sm', variant: 'outline', className: 'clip-panel-action',
                  icon: h(IconChevronLeftOutlineMedium, { size: 13 }),
                  onClick: () => ctx.layout.selectPanel(null),
                }, t('backToChat')),
                h(Button, {
                  type: 'button', size: 'sm', variant: 'primary', className: 'clip-panel-action',
                  icon: h(IconSearchOutlineRegular, { size: 13 }), onClick: source.scan, disabled: busy || connected,
                }, connection === 'scanning' ? t('scanning') : demo ? t('scanDemo') : t('scan')))),
            error && h('p', { className: 'clip-panel-note', role: 'alert' }, errorMessage(error.key, error.args, t('error.operation-failed'))),
            h('section', { className: 'clip-panel-group', 'aria-label': t('devices') },
              h('h2', null, t('devices')),
              rows.length
                ? h('ul', { className: 'clip-panel-list' }, rows.map(item => {
                  const selected = connected && (demo || item.id === device?.id)
                  return h('li', { key: item.id, className: 'clip-panel-row' },
                    h('span', { className: 'clip-panel-icon' }, h(ClipIcon, { size: 22 })),
                    h('div', { className: 'clip-panel-row-body' },
                      h('span', { className: 'clip-panel-row-name' }, item.name),
                      h('p', { className: 'clip-panel-note', role: 'status' }, demo
                        ? (selected ? t('demoConnected') : t('disconnected'))
                        : selected ? t('connectedBattery', { battery: device.battery }) : item.id)),
                    h(Button, {
                      type: 'button', size: 'sm', variant: 'outline', className: 'clip-panel-action',
                      onClick: selected ? source.disconnect : () => source.connect(item.id),
                      disabled: busy || (connected && !selected),
                    }, selected ? (demo ? t('disconnectDemo') : t('disconnect')) : (demo ? t('connectDemo') : t('connect'))))
                }))
                : h('p', { className: 'clip-panel-note', role: 'status' }, connection === 'scanning'
                  ? t('searching') : scanned ? t('noDevices') : t('scanPrompt'))),
            !demo && h('section', { className: 'clip-panel-group', 'aria-label': t('speech') },
              h('h2', null, t('speech')),
              h('div', { className: 'clip-panel-row' },
                h('div', { className: 'clip-panel-row-body' },
                  h('span', { className: 'clip-panel-row-name' }, 'SenseVoice'),
                  h('p', { className: 'clip-panel-note', role: 'status' },
                    speechInstall === 'installing' ? t('installingSpeech')
                      : speechInstall === 'restart-required' && speechPhase === 'unavailable'
                        ? t('restartSpeech')
                        : (speechLabels[speechPhase] ?? '') + percentage)),
                speechAction && h(Button, {
                  type: 'button', size: 'sm', variant: 'outline',
                  disabled: speechBusy || speechInstall === 'installing',
                  onClick: speechAction.run,
                }, speechAction.label))),
            h('section', { className: 'clip-panel-group', 'aria-label': demo ? t('pendingTranscripts') : t('recordingResults') },
              h('h2', null, demo ? t('pendingTranscripts') : t('recordingResults')),
              !demo && h('div', { className: 'clip-panel-actions' },
                h('label', { className: 'clip-panel-mode' }, t('recordingMode'),
                  h('select', {
                    value: recordingMode, disabled: Boolean(task || recordingCommand || recovering),
                    onChange: event => source.selectRecordingMode(event.target.value),
                  }, h('option', { value: 'rtc' }, t('rtcMode')), h('option', { value: 'sd' }, t('sdMode')))),
                connected && h(Button, {
                  type: 'button', size: 'sm', variant: 'primary',
                  disabled: Boolean(recordingCommand) || recovering || (Boolean(task) && !isRecording),
                  onClick: isRecording ? source.stop : source.start,
                }, t(isRecording ? 'stopRecording' : 'startRecording', { mode: currentMode })),
                h(Button, {
                  type: 'button', size: 'sm', variant: 'outline',
                  disabled: !connected || Boolean(task || recovering || recordingCommand),
                  onClick: source.syncLatest,
                }, recovering ? t('findingLatest') : t('syncLatest'))),
              !demo && task && h('p', { className: 'clip-panel-note', role: 'status' },
                task.phase === 'recording' || task.phase === 'paused' ? t('recordingOrPaused') : t('processing')),
              pending.length
                ? h('ul', { className: 'clip-panel-list' }, pending.map(item =>
                  h('li', { key: item.id, className: 'clip-panel-row' },
                    h('div', { className: 'clip-panel-row-body' },
                      h('div', { className: 'clip-panel-row-name' }, item.text ??
                        (item.phase === 'empty' ? t('emptyTranscript') : errorMessage(item.messageKey, item.messageArgs, t('recordingFailed')))),
                      item.text && h('p', { className: 'clip-panel-note' }, item.sessionId ? t('insertOriginalChat') : t('insertOpenChat'))),
                    !demo && item.retryable && h(Button, {
                      type: 'button', size: 'sm', variant: 'outline', disabled: busy,
                      onClick: () => source.retry(item.id),
                    }, t('retry')),
                    !demo && h(Button, {
                      type: 'button', size: 'sm', variant: 'outline', onClick: () => source.ackResult(item.id),
                    }, t('clear')))))
                : h('p', { className: 'clip-panel-note' }, t('noResults')))))
      }

      function ClipComposer({ sessionId, inputActions, locked, onActiveChange }) {
        useLocale()
        const { connection, task, pending, recordingCommand, recordingMode, recovering } = useSyncExternalStore(source.subscribe, source.getSnapshot)
        const { activePanelId } = useSyncExternalStore(panelInfo.subscribe, panelInfo.getSnapshot)
        const result = pending.findLast(item => item.sessionId === sessionId || item.sessionId === undefined)
        const editingLocked = useRef(locked)
        editingLocked.current = locked
        const expanded = activePanelId === null && Boolean(task || result)
        useLayoutEffect(() => {
          onActiveChange(expanded)
          return () => onActiveChange(false)
        }, [expanded, onActiveChange])
        useLayoutEffect(() => {
          const binding = bindDraft(source, sessionId, inputActions, () => !editingLocked.current && canEdit())
          const stopWatchingPanel = panelInfo.subscribe(() => {
            if (!conversationVisible()) binding.invalidate()
          })
          function handleVisibility() {
            if (document.hidden) binding.invalidate()
          }
          window.addEventListener('blur', binding.invalidate)
          document.addEventListener('visibilitychange', handleVisibility)
          return () => {
            stopWatchingPanel()
            window.removeEventListener('blur', binding.invalidate)
            document.removeEventListener('visibilitychange', handleVisibility)
            binding.dispose()
          }
        }, [sessionId, inputActions])

        if (activePanelId !== null || (connection !== 'connected' && !result && !task)) return null
        const keepEditorFocus = event => event.preventDefault()
        if (!expanded) {
          return h(Tooltip, { label: t('voiceInput'), side: 'top', portal: true },
            h('span', { className: 'clip-voice-idle' },
              h(Button, {
                type: 'button', className: 'clip-voice-trigger', size: 'sm',
                'aria-label': demo ? t('startDemo') : t('startClipRecording', { mode: modeLabel(recordingMode) }),
                disabled: locked || Boolean(recordingCommand) || recovering,
                onMouseDown: keepEditorFocus,
                async onClick() {
                  if (await source.start() === false) ctx.layout.selectPanel(panelId)
                },
              }, h(IconMicrophoneOutlineRegular, { size: 18 }))))
        }

        const phase = task?.phase ?? (result.text ? 'feedback' : result.phase)
        const isRecording = phase === 'recording'
        const isFeedback = phase === 'feedback'
        const messages = {
          feedback: t('transcriptReady'), syncing: t('syncing'),
          decoding: t('decoding'), transcribing: t('transcribing'), paused: t('paused'),
          'waiting-speech': t('waitingSpeech'), empty: t('emptyTranscript'), error: t('clipRecordingFailed'),
        }
        const message = phase === 'error' ? errorMessage(result?.messageKey, result?.messageArgs, messages.error) : messages[phase]
        const dismissible = !task
        return h('div', {
          className: 'clip-voice-row',
          'data-voice-activity': phase,
          'aria-label': t('voiceInput'),
        },
        (demo || dismissible) && h(Button, {
          type: 'button', className: 'clip-voice-round', size: 'sm',
          'aria-label': dismissible ? t('clearResult') : t('cancelRecording'),
          onMouseDown: keepEditorFocus,
          onClick: dismissible ? () => source.ackResult(result.id) : source.cancel,
        }, h(IconCloseOutlineRegular, { size: 14 })),
        isRecording
          ? h(Waveform, { readAmplitude: source.readAmplitude, label: t('recordingWaveform') })
          : h('span', {
            className: 'clip-voice-message', role: 'status', title: isFeedback ? result.text : message,
          }, !dismissible && phase !== 'paused' && h(StateDot, { state: 'ongoing' }), h('span', { className: 'clip-voice-message-text' }, message)),
        (demo ? isRecording : task && (isRecording || phase === 'paused')) && h(Button, {
          type: 'button', className: 'clip-voice-round', size: 'sm',
          'aria-label': demo ? t('stopDemo') : t('stopClipRecording', { mode: modeLabel(task.transport) }),
          disabled: Boolean(recordingCommand), onMouseDown: keepEditorFocus, onClick: source.stop,
        }, h(IconStopFillRegular, { size: 14 })),
        isFeedback && h(Button, {
          type: 'button', className: 'clip-voice-insert', size: 'sm',
          disabled: locked, onMouseDown: keepEditorFocus,
          onClick() {
            if (inputActions.insertText(result.text, inputActions.captureInsertion())) source.ackResult(result.id)
          },
        }, t('insert')))
      }

      ctx.effect(() => source.dispose)
      ctx.effect(() => {
        const style = document.createElement('style')
        style.textContent = panelStyles + activityStyles
        document.head.append(style)
        return () => style.remove()
      })
      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: panelId }, ClipPanel))
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: panelId, label: 'Clip' }, ClipIcon))
      ctx.slots.inject(activitySlot, () => {
        let disposeActivity
        function updateActivity({ connection, pending, task }) {
          if (connection === 'connected' || pending.length || task) {
            disposeActivity ??= ctx.slots.register({ name: activitySlot, priority: -1 }, ClipComposer)
          } else if (disposeActivity) {
            disposeActivity()
            disposeActivity = undefined
          }
        }

        const unsubscribe = source.subscribe(updateActivity)
        updateActivity(source.getSnapshot())
        return () => {
          unsubscribe()
          disposeActivity?.()
        }
      })
    }

    async function apply(ctx) {
      const demo = new URL(window.location.href).searchParams.get('clip-demo') === '1'
      if (demo) return registerUi(ctx, true)
      const dispose = await ctx.remote.$mount({ package: 'dsh-clip-for-agent', descriptors: clipDescriptors() })
      const ui = ctx.inject(['remote.clip', 'slots', 'layout', 'locale'], child => registerUi(child, false))
      try {
        await ui
      } catch (error) {
        await ui.dispose()
        await dispose()
        throw error
      }
      return async () => {
        await ui.dispose()
        await dispose()
      }
    }

    return { inject: ['slots', 'layout', 'remote', 'locale'], apply }
  },
})
