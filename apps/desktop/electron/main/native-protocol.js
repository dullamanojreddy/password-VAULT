// ─── Native-helper IPC protocol ────────────────────────────────────────────
// Newline-delimited JSON exchanged over a Windows named pipe between this
// Electron main process and the .NET 8 UI Automation helper
// (native-helper/AegisNativeHelper). Mirrored — field-for-field — by
// Protocol.cs on the C# side; keep the two in sync.
//
// The pipe itself is the authentication boundary: it is created with a
// PipeSecurity ACL restricted to the current Windows user (see
// PipeServer.cs), so no shared-secret token needs to travel through a
// command-line argument, environment variable, or file. Every message is
// still schema-validated here regardless, because "the transport is
// trusted" and "the payload is well-formed" are different guarantees.

export const HELPER_MESSAGE_TYPES = Object.freeze({
  HELLO: 'hello',
  FIELD_DETECTED: 'field-detected',
  FIELD_LOST: 'field-lost',
  INSERT_RESULT: 'insert-result',
  UNSUPPORTED_TARGET: 'unsupported-target',
})

export const ELECTRON_MESSAGE_TYPES = Object.freeze({
  INSERT_REQUEST: 'insert-request',
  SET_PAUSED: 'set-paused',
  SHUTDOWN: 'shutdown',
})

function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0 }
function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v) }

const APP_IDENTITY_SCHEMA = (v) => {
  if (!isPlainObject(v)) return false
  if (v.type !== 'win32' && v.type !== 'uwp') return false
  if (v.executableHash != null && typeof v.executableHash !== 'string') return false
  if (v.packageFamilyId != null && typeof v.packageFamilyId !== 'string') return false
  return true
}

const HELPER_SCHEMAS = {
  [HELPER_MESSAGE_TYPES.HELLO]: (p) => isPlainObject(p) && isNonEmptyString(p.version),
  [HELPER_MESSAGE_TYPES.FIELD_DETECTED]: (p) =>
    isPlainObject(p) &&
    ['login', 'signup', 'password-change', 'unknown'].includes(p.classification) &&
    typeof p.confidence === 'number' &&
    isPlainObject(p.control) && typeof p.control.automationId === 'string' &&
    isPlainObject(p.process) && Number.isInteger(p.process.pid) &&
    APP_IDENTITY_SCHEMA(p.appIdentity),
  [HELPER_MESSAGE_TYPES.FIELD_LOST]: () => true,
  [HELPER_MESSAGE_TYPES.INSERT_RESULT]: (p) =>
    isPlainObject(p) && isNonEmptyString(p.requestId) && typeof p.ok === 'boolean',
  [HELPER_MESSAGE_TYPES.UNSUPPORTED_TARGET]: (p) => isPlainObject(p) && isNonEmptyString(p.reason),
}

const ELECTRON_SCHEMAS = {
  [ELECTRON_MESSAGE_TYPES.INSERT_REQUEST]: (p) =>
    isPlainObject(p) && isNonEmptyString(p.requestId) && isNonEmptyString(p.password) &&
    isPlainObject(p.expectedIdentity) && APP_IDENTITY_SCHEMA(p.expectedIdentity) &&
    Number.isInteger(p.expectedProcessId) && isNonEmptyString(p.expectedAutomationId),
  [ELECTRON_MESSAGE_TYPES.SET_PAUSED]: (p) => isPlainObject(p) && typeof p.paused === 'boolean',
  [ELECTRON_MESSAGE_TYPES.SHUTDOWN]: () => true,
}

export function validateHelperMessage(msg) {
  if (!isPlainObject(msg) || !isNonEmptyString(msg.type)) return { ok: false, error: 'malformed envelope' }
  const schema = HELPER_SCHEMAS[msg.type]
  if (!schema) return { ok: false, error: `unknown helper message type "${msg.type}"` }
  if (!schema(msg.payload)) return { ok: false, error: `invalid payload for "${msg.type}"` }
  return { ok: true }
}

export function validateElectronMessage(msg) {
  if (!isPlainObject(msg) || !isNonEmptyString(msg.type)) return { ok: false, error: 'malformed envelope' }
  const schema = ELECTRON_SCHEMAS[msg.type]
  if (!schema) return { ok: false, error: `unknown electron message type "${msg.type}"` }
  if (!schema(msg.payload)) return { ok: false, error: `invalid payload for "${msg.type}"` }
  return { ok: true }
}
