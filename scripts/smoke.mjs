/**
 * Offline smoke test for the dsh-codex-image-bridge plugin.
 *
 * Loads the real plugin module (bare @deepseek-ai/* imports resolve through
 * ./node_modules symlinks) and calls apply() with a stub Context that records
 * tool registrations, then asserts the four expected tools are registered with
 * valid names/descriptions and that the Config schema validates a sample
 * config. No Codex app-server connection is made.
 *
 * Run: node scripts/smoke.mjs
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pluginUrl = new URL('../src/index.ts', import.meta.url).href

const mod = await import(pluginUrl)
assert.equal(typeof mod.apply, 'function', 'plugin must export apply()')
assert.equal(mod.name, 'dsh-codex-image-bridge')

// Validate the exported Config schema against a sample config (defaults apply).
// Cordis configs are Standard Schemas: validate via the `~standard` key.
const validation = mod.Config['~standard'].validate({
  skillDir: join(root, 'node_modules'), // any existing dir is fine here
})
assert.ok(!validation.issues, `config should validate: ${JSON.stringify(validation.issues)}`)
const sample = validation.value
assert.equal(typeof sample.timeoutMs, 'number')
assert.equal(typeof sample.skillDir, 'string')

const registered = []
const ctx = {
  tools: {
    register(def) {
      registered.push(def)
      return () => {}
    },
  },
  attachments: {
    saveImage: async () => {
      throw new Error('not used in smoke test')
    },
  },
  logger: {
    info: (...a) => console.log('[plugin]', ...a),
    warn: (...a) => console.warn('[plugin:warn]', ...a),
  },
}

mod.apply(ctx, sample)

const names = registered.map((d) => d.name)
console.log('registered tools:', names.join(', '))

for (const expected of [
  'codex_image_auth_status',
  'codex_image_generate',
  'codex_image_edit',
  'codex_image_describe',
]) {
  const def = registered.find((d) => d.name === expected)
  assert.ok(def, `missing tool ${expected}`)
  assert.equal(typeof def.description, 'string')
  assert.ok(def.description.length > 20, `${expected}: description too short`)
  assert.equal(typeof def.execute, 'function')
  assert.equal(typeof def.output.render, 'function')
  assert.ok(def.output.schema, `${expected}: missing output schema`)
}

// generate/edit parameter contract (compiled JSON Schema shape)
for (const name of ['codex_image_generate', 'codex_image_edit']) {
  const def = registered.find((d) => d.name === name)
  assert.equal(def.parameters.type, 'object')
  assert.equal(def.parameters.properties.prompt.type, 'string')
  assert.ok(def.parameters.required.includes('prompt'), `${name}: prompt must be required`)
}

console.log('smoke test OK — all 4 tools registered')
