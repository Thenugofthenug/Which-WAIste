// randomUUID is HTTPS/localhost-only. getRandomValues also works on LAN HTTP.
// Both paths produce random UUIDs accepted by the API; retries retain that ID.
export function newEventId(cryptoSource = globalThis.crypto) {
  if (typeof cryptoSource?.randomUUID === 'function') return cryptoSource.randomUUID()
  if (typeof cryptoSource?.getRandomValues !== 'function') {
    throw new Error('This browser cannot record activity. Please use a current browser.')
  }
  const bytes = cryptoSource.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
