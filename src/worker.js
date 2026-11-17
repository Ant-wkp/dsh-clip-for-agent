import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

export class ClipWorker {
  #instance
  #closed = false
  #serial = 0
  #pending = new Map()

  constructor(subprocess, onEvent) {
    this.subprocess = subprocess
    this.onEvent = onEvent
  }

  async #start() {
    if (process.platform !== 'linux' || process.arch !== 'x64') {
      throw new Error('Clip worker supports Linux x86-64')
    }
    const dir = await mkdtemp(join(tmpdir(), 'dsh-clip-'))
    let child
    let lines
    const ready = Promise.withResolvers()
    const gone = new Error('Clip device process stopped')
    const deadline = setTimeout(() => ready.reject(new Error('Clip device process did not start')), 10000)
    try {
      child = this.subprocess.spawn({
        argv: [fileURLToPath(new URL('../runtime/linux-x64/clip-worker', import.meta.url)), dir],
        cwd: dir,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 65536 } },
        graceMs: 1500,
      })
      if (!child.stdin || !child.stdout) throw gone
      child.stdin.on('error', () => child.terminate())
      lines = createInterface({ input: child.stdout })
      lines.on('line', line => {
        try {
          const message = JSON.parse(line)
          if (message.event === 'ready') {
            if (message.data?.protocol === 1) ready.resolve()
            else ready.reject(new Error('Unsupported Clip worker protocol'))
          } else if (message.event) {
            this.onEvent(message.event, message.data)
          } else {
            const request = this.#pending.get(message.id)
            if (message.ok) request?.resolve(message.value)
            else request?.reject(Object.assign(new Error(message.error), { code: message.code }))
          }
        } catch {
          child.terminate()
        }
      })
      const stopped = () => {
        ready.reject(gone)
        lines.close()
        for (const request of this.#pending.values()) request.reject(gone)
        this.#instance = undefined
        if (!this.#closed) this.onEvent('disconnected', { reason: 'worker-exit' })
        void child.waitForExit(AbortSignal.timeout(5000)).then(
          exited => exited && rm(dir, { recursive: true, force: true }),
        ).catch(() => {})
      }
      void child.done.then(stopped, stopped)
      await ready.promise
      return { child, dir }
    } catch (error) {
      lines?.close()
      child?.terminate()
      const stopped = !child || await child.waitForExit(AbortSignal.timeout(5000)).catch(() => false)
      if (stopped) await rm(dir, { recursive: true, force: true })
      throw error
    } finally {
      clearTimeout(deadline)
    }
  }

  async call(method, args = [], timeoutMs = 30000) {
    if (this.#closed) throw new Error('Clip device process has been disposed')
    const starting = this.#instance ??= this.#start()
    let instance
    try {
      instance = await starting
    } catch (error) {
      if (this.#instance === starting) this.#instance = undefined
      throw error
    }
    if (this.#closed) throw new Error('Clip device process has been disposed')
    const id = ++this.#serial
    const request = Promise.withResolvers()
    this.#pending.set(id, request)
    const timer = setTimeout(() => {
      request.reject(new Error('Clip device process request timed out'))
      instance.child.terminate()
    }, timeoutMs)
    try {
      instance.child.stdin.write(JSON.stringify({ id, method, args }) + '\n')
      return await request.promise
    } finally {
      clearTimeout(timer)
      this.#pending.delete(id)
    }
  }

  async clearRecording(address, recordingId) {
    const instance = await this.#instance?.catch(() => undefined)
    if (instance) await rm(join(instance.dir, address.replaceAll(':', ''), recordingId), { recursive: true, force: true })
  }

  async dispose() {
    this.#closed = true
    const instance = await this.#instance?.catch(() => undefined)
    if (!instance) return
    instance.child.stdin.end()
    if (!await instance.child.waitForExit(AbortSignal.timeout(1000)).catch(() => false)) {
      instance.child.terminate()
      if (!await instance.child.waitForExit(AbortSignal.timeout(5000)).catch(() => false)) return
    }
    await rm(instance.dir, { recursive: true, force: true })
  }
}
