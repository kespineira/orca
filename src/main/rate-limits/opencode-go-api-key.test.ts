import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as NodeOs from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getOpenCodeGoConfigHash, resolveOpenCodeGoApiKeys } from './opencode-go-api-key'

const home = vi.hoisted(() => ({ path: '' }))
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeOs>()),
  homedir: () => home.path
}))

let directory: string
function writeAuth(value: unknown, dataHome = directory): void {
  mkdirSync(join(dataHome, 'opencode'), { recursive: true })
  writeFileSync(join(dataHome, 'opencode', 'auth.json'), JSON.stringify(value))
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'orca-opencode-key-'))
  home.path = directory
  vi.stubEnv('XDG_DATA_HOME', directory)
  vi.stubEnv('OPENCODE_API_KEY', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})

describe('OpenCode Go API key sources', () => {
  it('prefers the setting, then environment, then auth.json, then no key for cookie fallback', () => {
    writeAuth({ 'opencode-go': { type: 'api', key: 'oc_sk_fake-file' } })
    vi.stubEnv('OPENCODE_API_KEY', ' fake-env ')
    expect(resolveOpenCodeGoApiKeys(' fake-setting ')).toEqual([
      { source: 'setting', key: 'fake-setting' }
    ])
    expect(resolveOpenCodeGoApiKeys(' ')).toEqual([
      { source: 'environment', key: 'fake-env' },
      { source: 'auth-file', key: 'oc_sk_fake-file' }
    ])
    vi.stubEnv('OPENCODE_API_KEY', ' ')
    expect(resolveOpenCodeGoApiKeys()).toEqual([{ source: 'auth-file', key: 'oc_sk_fake-file' }])
    rmSync(join(directory, 'opencode', 'auth.json'))
    expect(resolveOpenCodeGoApiKeys()).toEqual([])
  })

  it('uses the home .local/share layout when XDG_DATA_HOME is absent', () => {
    vi.stubEnv('XDG_DATA_HOME', '')
    writeAuth(
      { 'opencode-go': { type: 'api', key: 'fake-home' } },
      join(directory, '.local', 'share')
    )
    expect(resolveOpenCodeGoApiKeys()[0]?.key).toBe('fake-home')
  })

  it('keeps the auth-file source once when it matches the environment key', () => {
    vi.stubEnv('OPENCODE_API_KEY', 'fake-same')
    writeAuth({ 'opencode-go': { type: 'api', key: ' fake-same ' } })
    expect(resolveOpenCodeGoApiKeys()).toEqual([{ source: 'auth-file', key: 'fake-same' }])
  })

  it('changes the config hash when either environment or auth-file key changes', () => {
    vi.stubEnv('OPENCODE_API_KEY', 'fake-env-first')
    writeAuth({ 'opencode-go': { type: 'api', key: 'fake-file-first' } })
    const hash = getOpenCodeGoConfigHash(resolveOpenCodeGoApiKeys(), '', '')
    writeAuth({ 'opencode-go': { type: 'api', key: 'fake-file-second' } })
    expect(getOpenCodeGoConfigHash(resolveOpenCodeGoApiKeys(), '', '')).not.toBe(hash)
    writeAuth({ 'opencode-go': { type: 'api', key: 'fake-file-first' } })
    vi.stubEnv('OPENCODE_API_KEY', 'fake-env-second')
    expect(getOpenCodeGoConfigHash(resolveOpenCodeGoApiKeys(), '', '')).not.toBe(hash)
  })

  it.each([
    null,
    [],
    {},
    { 'opencode-go': null },
    { 'opencode-go': { type: 'oauth', key: 'fake' } },
    { 'opencode-go': { type: 'api', key: 123 } },
    { 'opencode-go': { type: 'api', key: ' ' } }
  ])('ignores malformed credentials %j', (value) => {
    writeAuth(value)
    expect(resolveOpenCodeGoApiKeys()).toEqual([])
  })

  it('ignores missing, invalid JSON, and oversized files', () => {
    expect(resolveOpenCodeGoApiKeys()).toEqual([])
    writeAuth({})
    writeFileSync(join(directory, 'opencode', 'auth.json'), '{bad json')
    expect(resolveOpenCodeGoApiKeys()).toEqual([])
    writeFileSync(join(directory, 'opencode', 'auth.json'), ' '.repeat(1_000_001))
    expect(resolveOpenCodeGoApiKeys()).toEqual([])
  })

  it('rereads credentials after reconnecting', () => {
    writeAuth({ 'opencode-go': { type: 'api', key: 'fake-first' } })
    expect(resolveOpenCodeGoApiKeys()[0]?.key).toBe('fake-first')
    writeAuth({ 'opencode-go': { type: 'api', key: 'fake-second' } })
    expect(resolveOpenCodeGoApiKeys()[0]?.key).toBe('fake-second')
  })

  it('changes the config hash with source, key, cookie, and workspace without retaining plaintext', () => {
    const key = { source: 'setting', key: 'fake-key' } as const
    const hash = getOpenCodeGoConfigHash([key], 'fake-cookie', 'wrk_a')
    expect(hash).not.toContain('fake')
    expect(getOpenCodeGoConfigHash([key], 'fake-cookie', 'wrk_a')).toBe(hash)
    for (const changed of [
      getOpenCodeGoConfigHash([{ ...key, source: 'environment' }], 'fake-cookie', 'wrk_a'),
      getOpenCodeGoConfigHash([{ ...key, key: 'fake-new' }], 'fake-cookie', 'wrk_a'),
      getOpenCodeGoConfigHash([key], '', 'wrk_a'),
      getOpenCodeGoConfigHash([key], 'fake-cookie', 'wrk_b'),
      getOpenCodeGoConfigHash([], 'fake-cookie', 'wrk_a')
    ]) {
      expect(changed).not.toBe(hash)
    }
  })
})
