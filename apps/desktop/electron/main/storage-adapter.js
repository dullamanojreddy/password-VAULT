// File-backed {get,set,remove} adapter matching @aegis/shared's
// LocalVaultClient contract — the desktop equivalent of the extension's
// chrome.storage.local wrapper. One JSON file per key, written atomically
// (write to a temp file, then rename) so a crash mid-write can never leave
// a half-written, corrupt vault file behind.
import { mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export function makeFileStorageAdapter(dir) {
  async function ensureDir() { await mkdir(dir, { recursive: true }) }
  function pathFor(key) { return join(dir, `${encodeURIComponent(key)}.json`) }

  return {
    async get(key) {
      try {
        const raw = await readFile(pathFor(key), 'utf8')
        return JSON.parse(raw)
      } catch (err) {
        if (err.code === 'ENOENT') return undefined
        throw err
      }
    },
    async set(key, value) {
      await ensureDir()
      const target = pathFor(key)
      const tmp = join(dir, `.tmp-${randomBytes(6).toString('hex')}`)
      await writeFile(tmp, JSON.stringify(value), 'utf8')
      // Windows can reject a rename onto an existing, momentarily-locked
      // target with EPERM/EBUSY under concurrent writers — POSIX allows
      // this atomically, Windows doesn't always. Retry briefly rather than
      // surfacing a spurious failure for what is, semantically, a normal
      // "last write wins" race.
      let lastErr
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await rename(tmp, target)
          return
        } catch (err) {
          lastErr = err
          if (err.code !== 'EPERM' && err.code !== 'EBUSY') throw err
          await new Promise((r) => setTimeout(r, 15 * (attempt + 1)))
        }
      }
      throw lastErr
    },
    async remove(key) {
      try { await rm(pathFor(key)) } catch (err) { if (err.code !== 'ENOENT') throw err }
    },
  }
}
