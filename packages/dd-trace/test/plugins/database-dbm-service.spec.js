'use strict'

const assert = require('node:assert/strict')

const { describe, it } = require('mocha')

require('../setup/core')

const DatabasePlugin = require('../../src/plugins/database')

const CONFIGURED_SERVICE = 'postgres.db'

function makeSpan (tags = {}) {
  return {
    context: () => ({
      _tags: tags,
      getTag: (key) => tags[key],
      getTags: () => tags,
      setTag: (key, value) => { tags[key] = value },
      hasTag: (key) => Object.hasOwn(tags, key),
    }),
    setTag () {},
    _spanContext: { toTraceparent: () => '00-aaa-bbb-01' },
    _processor: { sample () {} },
  }
}

/**
 * Build a plugin wired to the real `getPeerService` / `getPeerServiceRemap` implementations so the
 * peer data under test is the peer data the SQL comment path actually sees.
 *
 * @param {{ spanComputePeerService?: boolean, peerServiceMapping?: object }} tracerConfig
 */
function buildPlugin ({ spanComputePeerService = false, peerServiceMapping } = {}) {
  const tracer = { _service: 'orders-api', _env: 'prod', _version: '1.0.0' }
  const plugin = new DatabasePlugin(tracer, { spanComputePeerService, peerServiceMapping })
  plugin.configure({ dbmPropagationMode: 'service', enabled: true })
  return plugin
}

function getField (comment, key) {
  return new RegExp(`${key}='([^']*)'`).exec(comment)?.[1]
}

describe('DatabasePlugin DBM service name', () => {
  describe('with peer service computation disabled', () => {
    it('uses the configured database service', () => {
      const plugin = buildPlugin({ spanComputePeerService: false })

      const comment = plugin.createDbmComment(
        makeSpan({ 'db.name': 'ordersdb', 'out.host': 'db.internal' }), CONFIGURED_SERVICE)

      assert.strictEqual(getField(comment, 'dddbs'), CONFIGURED_SERVICE)
    })

    it('propagates an explicit peer service as ddprs without reattributing dddbs', () => {
      const plugin = buildPlugin({ spanComputePeerService: false })

      const comment = plugin.createDbmComment(
        makeSpan({ 'db.name': 'ordersdb', 'out.host': 'db.internal', 'peer.service': 'postgres-prod' }),
        CONFIGURED_SERVICE)

      assert.strictEqual(getField(comment, 'dddbs'), CONFIGURED_SERVICE)
      assert.strictEqual(getField(comment, 'ddprs'), 'postgres-prod')
    })
  })

  describe('with peer service computation enabled', () => {
    const tracerConfig = { spanComputePeerService: true, peerServiceMapping: {} }

    it('keeps the configured database service when the peer service is computed from db.name', () => {
      const plugin = buildPlugin(tracerConfig)

      const comment = plugin.createDbmComment(
        makeSpan({ 'db.name': 'ordersdb', 'out.host': 'db.internal' }), CONFIGURED_SERVICE)

      assert.strictEqual(getField(comment, 'dddbs'), CONFIGURED_SERVICE)
      assert.strictEqual(getField(comment, 'ddprs'), undefined,
        'a computed peer service must not be propagated as ddprs')
    })

    it('keeps the configured database service when the peer service is computed from out.host', () => {
      const plugin = buildPlugin(tracerConfig)

      const comment = plugin.createDbmComment(makeSpan({ 'out.host': 'db.internal' }), CONFIGURED_SERVICE)

      assert.strictEqual(getField(comment, 'dddbs'), CONFIGURED_SERVICE)
      assert.strictEqual(getField(comment, 'ddprs'), undefined)
    })

    it('keeps the configured database service when no peer service precursor is available', () => {
      const plugin = buildPlugin(tracerConfig)

      const comment = plugin.createDbmComment(makeSpan(), CONFIGURED_SERVICE)

      assert.strictEqual(getField(comment, 'dddbs'), CONFIGURED_SERVICE)
      assert.strictEqual(getField(comment, 'ddprs'), undefined)
    })

    it('uses an explicitly-set peer service for both dddbs and ddprs', () => {
      const plugin = buildPlugin(tracerConfig)

      const comment = plugin.createDbmComment(
        makeSpan({ 'db.name': 'ordersdb', 'out.host': 'db.internal', 'peer.service': 'postgres-prod' }),
        CONFIGURED_SERVICE)

      assert.strictEqual(getField(comment, 'dddbs'), 'postgres-prod')
      assert.strictEqual(getField(comment, 'ddprs'), 'postgres-prod')
    })

    it('applies a peer service mapping to an explicitly-set peer service', () => {
      const plugin = buildPlugin({ spanComputePeerService: true, peerServiceMapping: { 'postgres-prod': 'pg-mapped' } })

      const comment = plugin.createDbmComment(
        makeSpan({ 'db.name': 'ordersdb', 'out.host': 'db.internal', 'peer.service': 'postgres-prod' }),
        CONFIGURED_SERVICE)

      assert.strictEqual(getField(comment, 'dddbs'), 'pg-mapped')
    })

    it('ignores a peer service mapping for a computed peer service', () => {
      const plugin = buildPlugin({ spanComputePeerService: true, peerServiceMapping: { ordersdb: 'pg-mapped' } })

      const comment = plugin.createDbmComment(
        makeSpan({ 'db.name': 'ordersdb', 'out.host': 'db.internal' }), CONFIGURED_SERVICE)

      assert.strictEqual(getField(comment, 'dddbs'), CONFIGURED_SERVICE)
    })
  })
})
