import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeFileStorageAdapter } from '../electron/main/storage-adapter.js'

let dir, storage

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aegis-test-'))
  storage = makeFileStorageAdapter(dir)
})

afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('file storage adapter', () => {
  it('returns undefined for a key that has never been set', async () => {
    expect(await storage.get('nope')).toBeUndefined()
  })

  it('round-trips a JSON-serializable value', async () => {
    await storage.set('items', [{ a: 1 }, { b: 2 }])
    expect(await storage.get('items')).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('overwrites an existing value', async () => {
    await storage.set('k', 1)
    await storage.set('k', 2)
    expect(await storage.get('k')).toBe(2)
  })

  it('removes a value', async () => {
    await storage.set('k', 1)
    await storage.remove('k')
    expect(await storage.get('k')).toBeUndefined()
  })

  it('leaves no partial file if two writes to the same key race (atomic rename)', async () => {
    await Promise.all([storage.set('k', 'a'), storage.set('k', 'b')])
    const result = await storage.get('k')
    expect(['a', 'b']).toContain(result) // one full write wins — never a corrupt partial value
  })
})
