// ─── Pure renderer IPC router ───────────────────────────────────────────
// Mirrors apps/chrome-extension/src/background/router.js's design: all the
// actual decision logic lives here as a plain async function over injected
// dependencies (vaultClient, policyStore, a clipboard sink, a native-helper
// client) so it can be unit-tested without spinning up Electron, a real
// clipboard, or a real named pipe.

export const RENDERER_ACTIONS = Object.freeze({
  GET_STATUS: 'desktop/get-status',
  UNLOCK: 'desktop/unlock',
  LOCK: 'desktop/lock',
  GENERATE_PASSWORD: 'desktop/generate-password',
  ANALYZE_PASSWORD: 'desktop/analyze-password',
  LIST_CREDENTIALS: 'desktop/list-credentials',
  FIND_BY_APP_IDENTITY: 'desktop/find-by-app-identity',
  CREATE_CREDENTIAL: 'desktop/create-credential',
  REVEAL_AND_INSERT: 'desktop/reveal-and-insert',
  INSERT_GENERATED: 'desktop/insert-generated',
  COPY_GENERATED: 'desktop/copy-generated',
  COPY_CREDENTIAL: 'desktop/copy-credential',
  SUBMIT_AUDIT: 'desktop/submit-audit',
  GET_ASSISTANT_POLICY: 'desktop/get-assistant-policy',
  SET_GLOBALLY_ENABLED: 'desktop/set-globally-enabled',
  SET_PAUSED: 'desktop/set-paused',
  SET_APP_RULE: 'desktop/set-app-rule',
  CLEAR_APP_RULE: 'desktop/clear-app-rule',
})

const SCHEMAS = {
  [RENDERER_ACTIONS.GET_STATUS]: () => [],
  [RENDERER_ACTIONS.UNLOCK]: (p) => (typeof p?.username === 'string' && typeof p?.masterPassword === 'string' ? [] : ['username and masterPassword are required']),
  [RENDERER_ACTIONS.LOCK]: () => [],
  [RENDERER_ACTIONS.GENERATE_PASSWORD]: (p) => (p == null || typeof p === 'object' ? [] : ['payload must be an object or omitted']),
  [RENDERER_ACTIONS.ANALYZE_PASSWORD]: (p) => (typeof p?.password === 'string' ? [] : ['password is required']),
  [RENDERER_ACTIONS.LIST_CREDENTIALS]: () => [],
  [RENDERER_ACTIONS.FIND_BY_APP_IDENTITY]: (p) => (typeof p?.appIdentity === 'object' ? [] : ['appIdentity is required']),
  [RENDERER_ACTIONS.CREATE_CREDENTIAL]: (p) => [
    ...(typeof p?.app === 'string' && p.app ? [] : ['app is required']),
    ...(typeof p?.username === 'string' && p.username ? [] : ['username is required']),
    ...(typeof p?.password === 'string' && p.password ? [] : ['password is required']),
  ],
  [RENDERER_ACTIONS.REVEAL_AND_INSERT]: (p) => (typeof p?.id === 'string' ? [] : ['id is required']),
  [RENDERER_ACTIONS.INSERT_GENERATED]: (p) => [
    ...(typeof p?.password === 'string' && p.password ? [] : ['password is required']),
    ...(Number.isInteger(p?.expectedProcessId) ? [] : ['expectedProcessId is required']),
    ...(typeof p?.expectedAutomationId === 'string' ? [] : ['expectedAutomationId is required']),
    ...(p?.observedIdentity && typeof p.observedIdentity === 'object' ? [] : ['observedIdentity is required']),
  ],
  [RENDERER_ACTIONS.COPY_GENERATED]: (p) => (typeof p?.password === 'string' && p.password ? [] : ['password is required']),
  [RENDERER_ACTIONS.COPY_CREDENTIAL]: (p) => (typeof p?.id === 'string' ? [] : ['id is required']),
  [RENDERER_ACTIONS.SUBMIT_AUDIT]: (p) => (typeof p?.action === 'string' ? [] : ['action is required']),
  [RENDERER_ACTIONS.GET_ASSISTANT_POLICY]: () => [],
  [RENDERER_ACTIONS.SET_GLOBALLY_ENABLED]: (p) => (typeof p?.enabled === 'boolean' ? [] : ['enabled is required']),
  [RENDERER_ACTIONS.SET_PAUSED]: (p) => (typeof p?.paused === 'boolean' ? [] : ['paused is required']),
  [RENDERER_ACTIONS.SET_APP_RULE]: (p) => (typeof p?.appKey === 'string' && (p?.rule === 'allow' || p?.rule === 'deny') ? [] : ['appKey and rule are required']),
  [RENDERER_ACTIONS.CLEAR_APP_RULE]: (p) => (typeof p?.appKey === 'string' ? [] : ['appKey is required']),
}

export function validateRendererMessage(message) {
  if (!message || typeof message !== 'object' || typeof message.action !== 'string') {
    return { ok: false, error: 'malformed message envelope' }
  }
  const schema = SCHEMAS[message.action]
  if (!schema) return { ok: false, error: `unknown action "${message.action}"` }
  const errors = schema(message.payload)
  return errors.length ? { ok: false, error: `invalid payload — ${errors.join('; ')}` } : { ok: true }
}

/**
 * @param {{
 *   vaultClient: import('@aegis/shared/vault-client').LocalVaultClient,
 *   policyStore: ReturnType<typeof import('./policy-store.js').createPolicyStore>,
 *   nativeHelper: { requestInsert(args): Promise<{ok:boolean,error?:string}> },
 *   clipboard: { writeAndScheduleClear(text: string, seconds: number): void },
 * }} deps
 */
export function createIpcRouter(deps) {
  const { vaultClient, policyStore, nativeHelper, clipboard } = deps

  async function handle(message) {
    const validation = validateRendererMessage(message)
    if (!validation.ok) return { ok: false, error: validation.error }

    const { action, payload } = message

    switch (action) {
      case RENDERER_ACTIONS.GET_STATUS:
        return { ok: true, ...vaultClient.getStatus() }

      case RENDERER_ACTIONS.UNLOCK:
        return vaultClient.unlock(payload.username, payload.masterPassword)

      case RENDERER_ACTIONS.LOCK:
        await vaultClient.lock('user requested')
        return { ok: true }

      case RENDERER_ACTIONS.GENERATE_PASSWORD:
        return { ok: true, password: vaultClient.generatePassword(payload ?? {}) }

      case RENDERER_ACTIONS.ANALYZE_PASSWORD:
        return { ok: true, analysis: await vaultClient.analyzePassword(payload.password) }

      case RENDERER_ACTIONS.LIST_CREDENTIALS:
        if (!vaultClient.isUnlocked()) return { ok: false, error: 'locked' }
        return { ok: true, items: await vaultClient.listMetadata() }

      case RENDERER_ACTIONS.FIND_BY_APP_IDENTITY:
        if (!vaultClient.isUnlocked()) return { ok: false, error: 'locked' }
        return { ok: true, matches: await vaultClient.findByAppIdentity(payload.appIdentity) }

      case RENDERER_ACTIONS.CREATE_CREDENTIAL:
        if (!vaultClient.isUnlocked()) return { ok: false, error: 'locked' }
        return vaultClient.createCredential({ ...payload, source: 'desktop' })

      case RENDERER_ACTIONS.REVEAL_AND_INSERT: {
        if (!vaultClient.isUnlocked()) return { ok: false, error: 'locked' }
        const items = await vaultClient.listMetadata()
        const item = items.find((i) => i.id === payload.id)
        if (!item) return { ok: false, error: 'not-found' }
        if (payload.observedIdentity && !vaultClient.assertAppIdentityMatch(item, payload.observedIdentity)) {
          return { ok: false, error: 'identity-mismatch' }
        }
        const plaintext = await vaultClient.revealCredential(payload.id, { reasonForAudit: 'desktop-insert' })
        if (plaintext == null) return { ok: false, error: 'locked-or-not-found' }
        // The native helper independently re-validates window/process/control
        // identity immediately before writing — this call passes the SAME
        // identity descriptor already checked above so a mismatch there
        // fails a second, independent time rather than trusting one check.
        const insertResult = await nativeHelper.requestInsert({
          password: plaintext,
          expectedIdentity: item.appIdentity,
          expectedProcessId: payload.expectedProcessId,
          expectedAutomationId: payload.expectedAutomationId,
        })
        return insertResult
      }

      case RENDERER_ACTIONS.INSERT_GENERATED: {
        // Inserting a password AEGIS just generated — there is no vault item
        // yet, so there is no stored identity to match against. The native
        // helper still re-validates window / process / control identity
        // against what was observed at detection time before it writes
        // anything (see Program.cs HandleInsertRequest), which is the check
        // that actually matters here: we are not authorizing access to a
        // stored secret, we are making sure a brand-new secret lands in the
        // exact field the user was looking at.
        if (!vaultClient.isUnlocked()) return { ok: false, error: 'locked' }
        const result = await nativeHelper.requestInsert({
          password: payload.password,
          expectedIdentity: payload.observedIdentity,
          expectedProcessId: payload.expectedProcessId,
          expectedAutomationId: payload.expectedAutomationId,
        })
        if (result.ok) {
          await vaultClient.submitAudit('assistant.autofill_filled', 'Generated password inserted via desktop assistant', 'warn')
        }
        return result
      }

      case RENDERER_ACTIONS.COPY_GENERATED: {
        // Same clipboard policy as a saved-credential copy: auto-clear after
        // the policy countdown. Requires unlock so the assistant can't be
        // used as a generator-and-clipboard tool while the vault is locked.
        if (!vaultClient.isUnlocked()) return { ok: false, error: 'locked' }
        const policy = await vaultClient.getPolicy()
        clipboard.writeAndScheduleClear(payload.password, policy.clipboardClearSeconds)
        await vaultClient.submitAudit('assistant.copy', `Generated password copied — clears in ${policy.clipboardClearSeconds}s`, 'warn')
        return { ok: true }
      }

      case RENDERER_ACTIONS.COPY_CREDENTIAL: {
        if (!vaultClient.isUnlocked()) return { ok: false, error: 'locked' }
        const plaintext = await vaultClient.revealCredential(payload.id, { reasonForAudit: 'desktop-copy' })
        if (plaintext == null) return { ok: false, error: 'locked-or-not-found' }
        const policy = await vaultClient.getPolicy()
        clipboard.writeAndScheduleClear(plaintext, policy.clipboardClearSeconds)
        return { ok: true }
      }

      case RENDERER_ACTIONS.SUBMIT_AUDIT:
        await vaultClient.submitAudit(payload.action, payload.detail, payload.severity ?? 'info')
        return { ok: true }

      case RENDERER_ACTIONS.GET_ASSISTANT_POLICY:
        return { ok: true, policy: await policyStore.getState() }

      case RENDERER_ACTIONS.SET_GLOBALLY_ENABLED:
        return { ok: true, policy: await policyStore.setGloballyEnabled(payload.enabled) }

      case RENDERER_ACTIONS.SET_PAUSED:
        return { ok: true, policy: await policyStore.setPaused(payload.paused) }

      case RENDERER_ACTIONS.SET_APP_RULE:
        return { ok: true, policy: await policyStore.setAppRule(payload.appKey, payload.rule) }

      case RENDERER_ACTIONS.CLEAR_APP_RULE:
        return { ok: true, policy: await policyStore.clearAppRule(payload.appKey) }

      default:
        return { ok: false, error: `unhandled action "${action}"` }
    }
  }

  return { handle }
}
