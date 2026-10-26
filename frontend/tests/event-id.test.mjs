import assert from 'node:assert/strict'
import { test } from 'node:test'
import { webcrypto } from 'node:crypto'
import { newEventId } from '../src/eventId.js'

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('HTTPS browsers use the native UUID method with its crypto receiver', () => {
  const source = { randomUUID() { assert.equal(this, source); return 'native-id' } }
  assert.equal(newEventId(source), 'native-id')
})

test('LAN browsers without randomUUID get RFC4122 v4 IDs from secure random bytes', () => {
  const source = { getRandomValues(bytes) { bytes.fill(255); return bytes } }
  assert.equal(newEventId(source), 'ffffffff-ffff-4fff-bfff-ffffffffffff')
})

test('LAN event IDs remain distinct and valid for the backend UUID validator', () => {
  const source = { getRandomValues: bytes => webcrypto.getRandomValues(bytes) }
  const ids = Array.from({ length: 100 }, () => newEventId(source))
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.every(id => uuidV4.test(id)))
})

test('unsupported browsers fail explicitly rather than generating collision-prone IDs', () => {
  assert.throws(() => newEventId({}), /browser cannot record activity/)
})
