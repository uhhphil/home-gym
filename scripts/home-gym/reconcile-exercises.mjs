#!/usr/bin/env node
// Read-only Free Exercise DB reconciliation. Never changes catalogue IDs, history, or media.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SOURCE = 'https://github.com/yuhonas/free-exercise-db'
const EQUIPMENT = { 'body only': 'body weight', dumbbell: 'dumbbell', barbell: 'barbell', kettlebells: 'kettlebell', 'e-z curl bar': 'ez barbell', bands: 'band', cable: 'cable', machine: 'leverage machine', 'exercise ball': 'stability ball', 'medicine ball': 'medicine ball', 'foam roll': 'roller' }
const HOME_EQUIPMENT = new Set(['body only', 'dumbbell', 'barbell', 'kettlebells', 'e-z curl bar'])

// Only typography is normalized. Handedness, incline, stance, and apparatus remain distinct.
export function normalizedName(name) {
  return String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

function uniqueRows(rows, label) {
  if (!Array.isArray(rows)) throw new Error(`${label} must be an array`)
  const indexed = new Map()
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id.trim()) throw new Error(`${label}: missing string ID`)
    if (indexed.has(row.id)) throw new Error(`${label}: duplicate ID ${row.id}`)
    indexed.set(row.id, row)
  }
  return indexed
}

function canonicalId(id, catalogue) {
  const seen = new Set()
  while (catalogue.get(id)?.variantOf) {
    if (seen.has(id)) throw new Error(`Catalogue alias cycle at ${id}`)
    seen.add(id)
    id = catalogue.get(id).variantOf
  }
  if (!catalogue.has(id)) throw new Error(`Missing catalogue target ${id}`)
  return id
}

function reviewedMappings(reviewed) {
  if (!reviewed || typeof reviewed !== 'object' || Array.isArray(reviewed)) throw new Error('Reviewed crosswalk must be an object')
  const mappings = Object.hasOwn(reviewed, 'mappings') ? reviewed.mappings : {}
  if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) throw new Error('Reviewed mappings must be an object')
  return mappings
}

export function validateReviewedSource(reviewed, revision) {
  const mappings = reviewedMappings(reviewed)
  const hasMappings = Object.keys(mappings).length > 0
  if (hasMappings && (!Object.hasOwn(reviewed, 'source') || !Object.hasOwn(reviewed, 'revision'))) {
    throw new Error('Reviewed mappings require explicit source and revision pins')
  }
  if (Object.hasOwn(reviewed, 'source') && reviewed.source !== SOURCE) throw new Error('Reviewed mapping names a different source')
  if (Object.hasOwn(reviewed, 'revision') && reviewed.revision !== revision) throw new Error('Source revision changed; review mappings before continuing')
}

export function reconcileExercises(external, catalogue, reviewed = { mappings: {} }) {
  const sources = uniqueRows(external, 'Source')
  const targets = uniqueRows(catalogue, 'Catalogue')
  for (const row of external) if (typeof row.name !== 'string' || !row.name.trim()) throw new Error(`Source: missing name ${row.id}`)
  const names = new Map()
  for (const row of catalogue) {
    canonicalId(row.id, targets)
    if (row.variantOf) continue
    if (typeof row.name !== 'string' || !row.name.trim()) throw new Error(`Catalogue: missing name ${row.id}`)
    const key = normalizedName(row.name)
    names.set(key, [...(names.get(key) || []), row])
  }
  const mappings = reviewedMappings(reviewed)
  for (const [sourceId, mapping] of Object.entries(mappings)) {
    const source = sources.get(sourceId)
    if (!source) throw new Error(`Reviewed source no longer exists: ${sourceId}`)
    if (!mapping || typeof mapping.targetId !== 'string') throw new Error(`Reviewed target required: ${sourceId}`)
    const id = canonicalId(mapping.targetId, targets)
    const target = targets.get(id)
    if (id !== mapping.targetId) throw new Error(`Reviewed mapping must use canonical ID ${id}: ${sourceId}`)
    if (mapping.sourceName !== source.name || mapping.targetName !== target.name) throw new Error(`Reviewed names changed: ${sourceId}`)
    if (!mapping.note?.trim()) throw new Error(`Review note required: ${sourceId}`)
    if (EQUIPMENT[source.equipment] && EQUIPMENT[source.equipment] !== target.equipment) throw new Error(`Reviewed equipment differs: ${sourceId}`)
  }
  const rows = [...external].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(source => {
    const mapping = Object.hasOwn(mappings, source.id) ? mappings[source.id] : undefined
    const candidates = (names.get(normalizedName(source.name)) || [])
      .filter(target => EQUIPMENT[source.equipment] && target.equipment === EQUIPMENT[source.equipment])
      .map(target => ({ id: target.id, name: target.name })).sort((a, b) => a.id < b.id ? -1 : 1)
    const homeScope = HOME_EQUIPMENT.has(source.equipment) ? 'home' : source.equipment == null || source.equipment === 'other' ? 'review' : 'outside'
    return {
      sourceId: source.id, name: source.name, equipment: source.equipment ?? null, homeScope,
      status: mapping ? 'reviewed-existing' : candidates.length ? 'candidate-review' : 'unmatched-review',
      ...(mapping ? { targetId: mapping.targetId } : {}), candidates,
    }
  })
  const counts = rows.reduce((out, row) => { out[row.status] = (out[row.status] || 0) + 1; out[row.homeScope] = (out[row.homeScope] || 0) + 1; return out }, {})
  return { version: 1, source: SOURCE, policy: 'Read-only reconciliation. Candidates are not imports or approved duplicates. No instructions or media copied.', counts, rows }
}

export function run(argv) {
  if (argv.length < 1 || argv.length > 2) throw new Error('Usage: node scripts/home-gym/reconcile-exercises.mjs /path/to/free-exercise-db [reviewed-map.json]')
  const reference = path.resolve(argv[0])
  const external = JSON.parse(fs.readFileSync(path.join(reference, 'dist/exercises.json'), 'utf8'))
  const catalogue = fs.readdirSync(path.join(ROOT, 'catalogue/exercises')).filter(f => f.endsWith('.json')).sort()
    .map(f => JSON.parse(fs.readFileSync(path.join(ROOT, 'catalogue/exercises', f), 'utf8')))
  const reviewed = argv[1] ? JSON.parse(fs.readFileSync(path.resolve(argv[1]), 'utf8')) : { mappings: {} }
  const revision = execFileSync('git', ['-C', reference, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  validateReviewedSource(reviewed, revision)
  return { ...reconcileExercises(external, catalogue, reviewed), sourceRevision: revision }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(run(process.argv.slice(2)), null, 2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
