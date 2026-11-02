import test from 'node:test'
import assert from 'node:assert/strict'
import {
  INDEX_STATUS,
  FRESHNESS_STATUS,
  CODE_ENTITY_TYPES,
  CODE_RELATIONS,
  TRACE_DIRECTIONS,
  DEFAULT_UI_PORT,
} from '../src/types.mjs'

test('types constants are defined and frozen', () => {
  assert.equal(INDEX_STATUS.READY, 'ready')
  assert.equal(INDEX_STATUS.DEGRADED, 'degraded')
  assert.equal(INDEX_STATUS.INDEXING, 'indexing')

  assert.equal(FRESHNESS_STATUS.FRESH, 'fresh')
  assert.equal(FRESHNESS_STATUS.POTENTIALLY_STALE, 'potentially_stale')

  assert.equal(CODE_ENTITY_TYPES.FUNCTION, 'Function')
  assert.equal(CODE_ENTITY_TYPES.CLASS, 'Class')

  assert.equal(CODE_RELATIONS.CALLS, 'CALLS')
  assert.equal(CODE_RELATIONS.DEFINES, 'DEFINES')

  assert.equal(TRACE_DIRECTIONS.INBOUND, 'inbound')
  assert.equal(TRACE_DIRECTIONS.OUTBOUND, 'outbound')
  assert.equal(TRACE_DIRECTIONS.BOTH, 'both')

  assert.equal(DEFAULT_UI_PORT, 9749)

  assert.ok(Object.isFrozen(INDEX_STATUS))
  assert.ok(Object.isFrozen(FRESHNESS_STATUS))
  assert.ok(Object.isFrozen(CODE_ENTITY_TYPES))
  assert.ok(Object.isFrozen(CODE_RELATIONS))
  assert.ok(Object.isFrozen(TRACE_DIRECTIONS))
})
