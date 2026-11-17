import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { clipDescriptors } from '../src/contract.js'

const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
const marker = '// CLIP_WIRE_CONTRACT'
if (source.split(marker).length !== 2) throw new Error('Missing or duplicate Clip contract marker')
const contract = clipDescriptors.toString().replaceAll('\n', '\n    ')
await mkdir(new URL('../lib/', import.meta.url), { recursive: true })
await writeFile(new URL('../lib/client.js', import.meta.url), source.replace(marker, () => contract))
