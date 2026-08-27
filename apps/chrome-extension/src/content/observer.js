// ─── Scoped, debounced DOM watcher for dynamically-inserted password fields ─
// Deliberately does NOT re-query the entire document on every mutation.
// Only newly added subtrees are scanned, and only after a short debounce
// window collapses a burst of mutations (a typical SPA render touches the
// DOM dozens of times per navigation) into a single pass.

const CANDIDATE_SELECTOR = 'input[type="password"], input[autocomplete="new-password"], input[autocomplete="current-password"]'

export function createFieldWatcher({ onPasswordField, debounceMs = 250 }) {
  const seen = new WeakSet()
  let pendingRoots = []
  let debounceTimer = null

  function considerNode(node) {
    // Element or Document/DocumentFragment (e.g. a ShadowRoot) roots only.
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return

    if (node.nodeType === Node.ELEMENT_NODE && node.matches?.(CANDIDATE_SELECTOR) && !seen.has(node)) {
      seen.add(node)
      onPasswordField(node)
    }
    // Only this node's own subtree — not the whole page — and only open
    // shadow roots, which are the only ones any script can legally reach.
    for (const el of node.querySelectorAll ? node.querySelectorAll(CANDIDATE_SELECTOR) : []) {
      if (!seen.has(el)) { seen.add(el); onPasswordField(el) }
    }
    for (const el of node.querySelectorAll ? node.querySelectorAll('*') : []) {
      if (el.shadowRoot) considerNode(el.shadowRoot)
    }
  }

  function flush() {
    debounceTimer = null
    const batch = pendingRoots
    pendingRoots = []
    for (const root of batch) considerNode(root)
  }

  function onMutations(mutations) {
    let sawAddedElement = false
    for (const m of mutations) {
      if (m.type !== 'childList') continue
      for (const node of m.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          pendingRoots.push(node)
          sawAddedElement = true
        }
      }
    }
    if (!sawAddedElement) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(flush, debounceMs)
  }

  const observer = new MutationObserver(onMutations)

  function start(root = document.documentElement) {
    considerNode(root === document.documentElement ? document : root)
    observer.observe(root, { childList: true, subtree: true })
  }

  function stop() {
    observer.disconnect()
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
    pendingRoots = []
  }

  return { start, stop, _considerNode: considerNode } // last export: test hook only
}
