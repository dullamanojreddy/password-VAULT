export function makeMemoryStorage() {
  const store = new Map()
  return {
    async get(key) { return store.has(key) ? structuredClone(store.get(key)) : undefined },
    async set(key, value) { store.set(key, structuredClone(value)) },
    async remove(key) { store.delete(key) },
    _dump: () => Object.fromEntries(store),
  }
}
