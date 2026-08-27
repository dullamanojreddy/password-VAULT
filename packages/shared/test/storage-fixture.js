// A trivial in-memory storage adapter matching the {get,set,remove} contract
// LocalVaultClient expects. Used by both this package's own tests and can
// serve as a reference implementation for a new client's storage adapter.
export function makeMemoryStorage() {
  const store = new Map()
  return {
    async get(key) { return store.has(key) ? structuredClone(store.get(key)) : undefined },
    async set(key, value) { store.set(key, structuredClone(value)) },
    async remove(key) { store.delete(key) },
    _dump: () => Object.fromEntries(store), // test-only inspection hook
  }
}
