import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcileExercises, normalizedName, validateReviewedSource } from './reconcile-exercises.mjs'

const source = [{ id: 'Kettlebell_Swing', name: 'Kettlebell Swing', equipment: 'kettlebells' }]
const catalogue = [{ id: '0123', name: 'kettlebell swing', equipment: 'kettlebell' }, { id: '1123', variantOf: '0123' }]
const reviewed = { mappings: { Kettlebell_Swing: { targetId: '0123', sourceName: 'Kettlebell Swing', targetName: 'kettlebell swing', note: 'Same apparatus and movement; existing history stays on 0123.' } } }

test('candidates never silently become approved mappings and inputs are unchanged', () => {
  const before = JSON.stringify([source, catalogue])
  const result = reconcileExercises(source, catalogue)
  assert.equal(result.rows[0].status, 'candidate-review')
  assert.equal(result.rows[0].targetId, undefined)
  assert.deepEqual(result.rows[0].candidates.map(x => x.id), ['0123'])
  assert.equal(JSON.stringify([source, catalogue]), before)
})

test('reviewed mapping preserves padded canonical ID and repeat runs are identical', () => {
  const a = reconcileExercises(source, catalogue, reviewed)
  assert.equal(a.rows[0].targetId, '0123')
  assert.deepEqual(a, reconcileExercises(source, catalogue, reviewed))
})

test('multiple name matches are flagged for review instead of choosing one', () => {
  const result = reconcileExercises(source, [...catalogue, { ...catalogue[0], id: '9999' }])
  assert.equal(result.rows[0].status, 'candidate-review')
  assert.equal(result.rows[0].candidates.length, 2)
})

test('duplicate external IDs and stale reviews fail closed', () => {
  assert.throws(() => reconcileExercises([...source, ...source], catalogue), /duplicate ID/)
  assert.throws(() => reconcileExercises(source, [{ ...catalogue[0], name: 'one arm kettlebell swing' }], reviewed), /names changed/)
  assert.throws(() => reconcileExercises([], catalogue, reviewed), /no longer exists/)
})

test('unknown and cyclic catalogue aliases fail; reviewed targets must be canonical', () => {
  assert.throws(() => reconcileExercises(source, [...catalogue, { id: '7777', variantOf: 'missing' }]), /Missing catalogue target/)
  assert.throws(() => reconcileExercises(source, [{ id: 'a', variantOf: 'b' }, { id: 'b', variantOf: 'a' }]), /alias cycle/)
  const aliasReview = structuredClone(reviewed)
  aliasReview.mappings.Kettlebell_Swing.targetId = '1123'
  assert.throws(() => reconcileExercises(source, catalogue, aliasReview), /canonical ID/)
})

test('equipment, side, and stance differences are not collapsed', () => {
  const wrongEquipment = [{ ...catalogue[0], equipment: 'dumbbell' }]
  assert.equal(reconcileExercises(source, wrongEquipment).rows[0].candidates.length, 0)
  assert.throws(() => reconcileExercises(source, wrongEquipment, reviewed), /equipment differs/)
  assert.notEqual(normalizedName('single arm kettlebell swing'), normalizedName('kettlebell swing'))
  assert.notEqual(normalizedName('left lunge'), normalizedName('right lunge'))
})

test('unknown apparatus remains reviewable, not falsely treated as body weight', () => {
  const result = reconcileExercises([{ ...source[0], equipment: null }], catalogue)
  assert.equal(result.rows[0].homeScope, 'review')
  assert.equal(result.rows[0].candidates.length, 0)
})

test('nonempty reviewed crosswalks require their own explicit source and revision pins', () => {
  const pins = { source: 'https://github.com/yuhonas/free-exercise-db', revision: 'a'.repeat(40) }
  assert.throws(() => validateReviewedSource(reviewed, pins.revision), /require explicit source and revision/)
  assert.throws(() => validateReviewedSource({ ...reviewed, source: pins.source }, pins.revision), /require explicit source and revision/)
  assert.throws(() => validateReviewedSource({ ...reviewed, revision: pins.revision }, pins.revision), /require explicit source and revision/)
  const inherited = Object.assign(Object.create(pins), reviewed)
  assert.throws(() => validateReviewedSource(inherited, pins.revision), /require explicit source and revision/)
  assert.doesNotThrow(() => validateReviewedSource({ ...reviewed, ...pins }, pins.revision))
})

test('wrong or stale pins fail closed, including empty pin values', () => {
  const pins = { source: 'https://github.com/yuhonas/free-exercise-db', revision: 'a'.repeat(40) }
  for (const source of ['', null, 'https://example.com/different']) {
    assert.throws(() => validateReviewedSource({ ...reviewed, ...pins, source }, pins.revision), /different source/)
  }
  for (const revision of ['', null, 'b'.repeat(40)]) {
    assert.throws(() => validateReviewedSource({ ...reviewed, ...pins, revision }, pins.revision), /revision changed/)
  }
})

test('default empty reports need no pins and malformed crosswalks are rejected', () => {
  assert.doesNotThrow(() => validateReviewedSource({ mappings: {} }, 'a'.repeat(40)))
  assert.doesNotThrow(() => validateReviewedSource({}, 'a'.repeat(40)))
  for (const value of [null, [], { mappings: null }, { mappings: [] }, { mappings: 'invalid' }]) {
    assert.throws(() => validateReviewedSource(value, 'a'.repeat(40)), /must be an object/)
  }
})

test('prototype property names are opaque source IDs, never inherited reviewed mappings', () => {
  for (const id of ['constructor', 'toString', '__proto__']) {
    const result = reconcileExercises([{ ...source[0], id }], catalogue)
    assert.equal(result.rows[0].sourceId, id)
    assert.equal(result.rows[0].status, 'candidate-review')
    assert.equal(result.rows[0].targetId, undefined)
  }
  const mappings = Object.create({ Kettlebell_Swing: reviewed.mappings.Kettlebell_Swing })
  assert.equal(reconcileExercises(source, catalogue, { mappings }).rows[0].status, 'candidate-review')
})
