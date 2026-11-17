window.__ModuleLoader__.load({
  id: 'dsh-clip-for-agent',

  factory(require) {
    const { createElement: h, useLayoutEffect, useRef, useSyncExternalStore } = require('react')
    const {
      Button, IconChevronLeftOutlineMedium, IconCloseOutlineRegular, IconMicrophoneOutlineRegular,
      IconSearchOutlineRegular, IconStopFillRegular, StateDot, Tooltip,
    } = require('@deepseek-ai/dsh-client-ui-primitives')
    // CLIP_WIRE_CONTRACT
    const panelId = 'clip-for-agent'
    const activitySlot = 'conversation.input.activity'
    const demoText = '这是一条来自 Clip 的模拟语音转写。'
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

    function Waveform({ readAmplitude }) {
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
        preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Clip 正在输入',
      }, Array.from({ length: 80 }, (_, index) => {
        const x = index * 8 + 4
        return h('line', {
          key: index, x1: x, x2: x, y1: 19, y2: 21, stroke: 'currentColor',
          strokeWidth: 3, strokeLinecap: 'round', opacity: 0.25 + index / 120,
        })
      }))
    }

    function createDemoSource(enabled, window) {
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
              const result = { id, text: demoText, sessionId: targetSession }
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
      let state = { loaded: false, scanned: false, connection: 'disconnected', devices: [], device: null,
        speech: { phase: 'unavailable' }, task: null, pending: [], levels: [], error: null }
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
        ended: () => new Error('Clip 状态流已断开。'),
        carrierFailed: () => update({ error: '无法获取 Clip 状态。' }),
      })
      const observing = (async () => {
        try {
          for await (const item of stream) {
            update({ ...item.value, loaded: true })
            item.accept()
          }
        } catch {
          update({ error: '无法获取 Clip 状态。' })
        }
      })()
      async function invoke(method, ...args) {
        try {
          const response = await ctx.remote.clip[method](...args)
          if (!response.ok && method !== 'claimDraft') update({ error: response.error.message })
          return response.ok
        } catch {
          if (method !== 'claimDraft') update({ error: '无法执行 Clip 操作。' })
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
      const source = demo ? createDemoSource(true, window) : createRemoteSource(ctx)
      const panelInfo = ctx.layout.panelInfo
      const conversationVisible = () => panelInfo.getSnapshot().activePanelId === null
      const canEdit = () => conversationVisible() && !document.hidden && document.hasFocus()

      function ClipPanel() {
        const { loaded, scanned, connection, pending, devices, device, error, speech, speechInstall, task, recovering } = useSyncExternalStore(source.subscribe, source.getSnapshot)
        const busy = connection === 'scanning' || connection === 'connecting'
        const connected = connection === 'connected'
        const speechPhase = loaded ? speech?.phase : 'checking'
        const speechBusy = ['checking', 'downloading', 'loading', 'waking', 'cancelling'].includes(speechPhase)
        const speechLabels = {
          ready: '已就绪', standby: '已安装', unprepared: '需要下载模型',
          checking: '正在检查模型…', downloading: '正在下载模型…', loading: '正在加载模型…',
          waking: '正在加载模型…', failed: '安装失败', cancelled: '安装已取消', unavailable: '官方转写未启用',
        }
        const percentage = speech?.totalBytes > 0
          ? ' ' + Math.min(100, Math.floor(speech.completedBytes * 100 / speech.totalBytes)) + '%' : ''

        const speechAction = speechPhase === 'unavailable'
          ? (speechInstall === 'installing' || speechInstall === 'restart-required' ? null : {
            label: speechInstall === 'failed' ? '重试安装官方转写' : '安装官方转写', run: source.installSpeech,
          })
          : ['unprepared', 'failed', 'cancelled'].includes(speechPhase)
            ? { label: speechPhase === 'failed' ? '重试安装' : '安装 SenseVoice 模型', run: source.prepareSpeech }
            : null

        const rows = demo
          ? (scanned ? [{ id: 'demo', name: 'reSpeaker Clip（模拟）' }] : [])
          : [...devices, ...(device && !devices.some(item => item.id === device.id) ? [device] : [])]
        return h('section', { className: 'clip-panel', 'aria-label': 'Clip 设备面板' },
          h('div', { className: 'clip-panel-content' },
            h('header', { className: 'clip-panel-header', 'data-window-drag': true },
              h('div', null,
                h('h1', null, 'Clip'),
                h('p', { className: 'clip-panel-intro' }, '通过本机蓝牙连接 reSpeaker Clip。')),
              h('div', { className: 'clip-panel-actions' },
                h(Button, {
                  type: 'button', size: 'sm', variant: 'outline', className: 'clip-panel-action',
                  icon: h(IconChevronLeftOutlineMedium, { size: 13 }),
                  onClick: () => ctx.layout.selectPanel(null),
                }, '返回聊天'),
                h(Button, {
                  type: 'button', size: 'sm', variant: 'primary', className: 'clip-panel-action',
                  icon: h(IconSearchOutlineRegular, { size: 13 }), onClick: source.scan, disabled: busy || connected,
                }, connection === 'scanning' ? '扫描中…' : demo ? '扫描模拟设备' : '扫描设备'))),
            error && h('p', { className: 'clip-panel-note', role: 'alert' }, error),
            h('section', { className: 'clip-panel-group', 'aria-label': '设备' },
              h('h2', null, '设备'),
              rows.length
                ? h('ul', { className: 'clip-panel-list' }, rows.map(item => {
                  const selected = connected && (demo || item.id === device?.id)
                  return h('li', { key: item.id, className: 'clip-panel-row' },
                    h('span', { className: 'clip-panel-icon' }, h(ClipIcon, { size: 22 })),
                    h('div', { className: 'clip-panel-row-body' },
                      h('span', { className: 'clip-panel-row-name' }, item.name),
                      h('p', { className: 'clip-panel-note', role: 'status' }, demo
                        ? (selected ? '模拟 Clip 已连接' : '未连接')
                        : selected ? '已连接 · 电量 ' + device.battery + '%' : item.id)),
                    h(Button, {
                      type: 'button', size: 'sm', variant: 'outline', className: 'clip-panel-action',
                      onClick: selected ? source.disconnect : () => source.connect(item.id),
                      disabled: busy || (connected && !selected),
                    }, selected ? (demo ? '断开模拟设备' : '断开') : (demo ? '连接模拟设备' : '配对连接')))
                }))
                : h('p', { className: 'clip-panel-note', role: 'status' }, connection === 'scanning'
                  ? '正在搜索附近的 Clip…' : scanned ? '未发现 Clip。请让设备进入可配对状态后重新扫描。' : '点击扫描查找附近的 Clip。')),
            !demo && h('section', { className: 'clip-panel-group', 'aria-label': '语音转写' },
              h('h2', null, '语音转写'),
              h('div', { className: 'clip-panel-row' },
                h('div', { className: 'clip-panel-row-body' },
                  h('span', { className: 'clip-panel-row-name' }, 'SenseVoice'),
                  h('p', { className: 'clip-panel-note', role: 'status' },
                    speechInstall === 'installing' ? '正在安装官方转写…'
                      : speechInstall === 'restart-required' && speechPhase === 'unavailable'
                        ? '官方转写已安装，请重启 DSH 后继续。'
                        : (speechLabels[speechPhase] ?? '') + percentage)),
                speechAction && h(Button, {
                  type: 'button', size: 'sm', variant: 'outline',
                  disabled: speechBusy || speechInstall === 'installing',
                  onClick: speechAction.run,
                }, speechAction.label))),
            h('section', { className: 'clip-panel-group', 'aria-label': demo ? '待插入转写' : '录音结果' },
              h('h2', null, demo ? '待插入转写' : '录音结果'),
              !demo && h(Button, {
                type: 'button', size: 'sm', variant: 'outline', disabled: !connected || Boolean(task) || recovering,
                onClick: source.syncLatest,
              }, recovering ? '正在查找…' : '同步最近录音'),
              !demo && task && h('p', { className: 'clip-panel-note', role: 'status' },
                task.phase === 'recording' || task.phase === 'paused' ? 'Clip 正在录音或暂停' : '正在处理录音…'),
              pending.length
                ? h('ul', { className: 'clip-panel-list' }, pending.map(item =>
                  h('li', { key: item.id, className: 'clip-panel-row' },
                    h('div', { className: 'clip-panel-row-body' },
                      h('div', { className: 'clip-panel-row-name' }, item.text ??
                        (item.phase === 'empty' ? '未识别到语音' : item.message ?? '录音处理失败')),
                      item.text && h('p', { className: 'clip-panel-note' }, item.sessionId ? '返回原聊天可插入' : '打开聊天后可插入')),
                    !demo && item.retryable && h(Button, {
                      type: 'button', size: 'sm', variant: 'outline', disabled: busy,
                      onClick: () => source.retry(item.id),
                    }, '重试'),
                    !demo && h(Button, {
                      type: 'button', size: 'sm', variant: 'outline', onClick: () => source.ackResult(item.id),
                    }, '清除'))))
                : h('p', { className: 'clip-panel-note' }, '暂无结果'))))
      }

      function ClipComposer({ sessionId, inputActions, locked, onActiveChange }) {
        const { connection, task, pending } = useSyncExternalStore(source.subscribe, source.getSnapshot)
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
          return h(Tooltip, { label: 'Clip 语音输入', side: 'top', portal: true },
            h('span', { className: 'clip-voice-idle' },
              h(Button, {
                type: 'button', className: 'clip-voice-trigger', size: 'sm',
                'aria-label': demo ? '开始 Clip 录音（模拟）' : '打开 Clip 设备面板', disabled: locked,
                onMouseDown: keepEditorFocus, onClick: demo ? source.start : () => ctx.layout.selectPanel(panelId),
              }, h(IconMicrophoneOutlineRegular, { size: 18 }))))
        }

        const phase = task?.phase ?? (result.text ? 'feedback' : result.phase)
        const isRecording = phase === 'recording'
        const isFeedback = phase === 'feedback'
        const messages = {
          feedback: '转写完成，可插入草稿', syncing: '正在同步…',
          decoding: '正在解码…', transcribing: '正在转写…', paused: 'Clip 录音已暂停',
          'waiting-speech': '正在准备语音转写…', empty: '未识别到语音', error: 'Clip 录音处理失败',
        }
        const message = phase === 'error' ? result?.message ?? messages.error : messages[phase]
        const dismissible = !task
        return h('div', {
          className: 'clip-voice-row',
          'data-voice-activity': phase,
          'aria-label': 'Clip 语音输入',
        },
        (demo || dismissible) && h(Button, {
          type: 'button', className: 'clip-voice-round', size: 'sm',
          'aria-label': dismissible ? '清除 Clip 结果' : '取消 Clip 录音',
          onMouseDown: keepEditorFocus,
          onClick: dismissible ? () => source.ackResult(result.id) : source.cancel,
        }, h(IconCloseOutlineRegular, { size: 14 })),
        isRecording
          ? h(Waveform, { readAmplitude: source.readAmplitude })
          : h('span', {
            className: 'clip-voice-message', role: 'status', title: isFeedback ? result.text : message,
          }, !dismissible && phase !== 'paused' && h(StateDot, { state: 'ongoing' }), h('span', { className: 'clip-voice-message-text' }, message)),
        demo && isRecording && h(Button, {
          type: 'button', className: 'clip-voice-round', size: 'sm',
          'aria-label': '停止 Clip 录音（模拟）', onMouseDown: keepEditorFocus, onClick: source.stop,
        }, h(IconStopFillRegular, { size: 14 })),
        isFeedback && h(Button, {
          type: 'button', className: 'clip-voice-insert', size: 'sm',
          disabled: locked, onMouseDown: keepEditorFocus,
          onClick() {
            if (inputActions.insertText(result.text, inputActions.captureInsertion())) source.ackResult(result.id)
          },
        }, '插入'))
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
      const ui = ctx.inject(['remote.clip', 'slots', 'layout'], child => registerUi(child, false))
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

    return { inject: ['slots', 'layout', 'remote'], apply }
  },
})
