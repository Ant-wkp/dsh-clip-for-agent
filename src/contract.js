// This function is also embedded in the DSH browser module.
export function clipDescriptors() {
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
  const taskId = codec('TaskId', value => typeof value === 'string' && /^[0-9A-F]{12}-\d{14}$/.test(value))
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
