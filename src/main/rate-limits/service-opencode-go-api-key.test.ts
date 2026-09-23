import {
  errorProvider,
  okProvider,
  resetRateLimitProviderMocks
} from './rate-limit-service-test-harness'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RateLimitService } from './service'
import { fetchClaudeRateLimits } from './claude-fetcher'
import { fetchCodexRateLimits } from './codex-fetcher'
import { fetchOpenCodeGoRateLimits } from './opencode-go-usage-fetcher'
import * as OpenCodeGoApiKeyModule from './opencode-go-api-key'

vi.mock('./claude-fetcher', () => ({
  fetchClaudeRateLimits: vi.fn(),
  fetchManagedAccountUsage: vi.fn()
}))

vi.mock('./codex-fetcher', () => ({
  consumeCodexRateLimitResetCredit: vi.fn(),
  fetchCodexRateLimits: vi.fn()
}))

vi.mock('./gemini-usage-fetcher', () => ({
  fetchGeminiRateLimits: vi.fn()
}))

vi.mock('./kimi-fetcher', () => ({
  fetchKimiRateLimits: vi.fn()
}))

vi.mock('./opencode-go-usage-fetcher', () => ({
  fetchOpenCodeGoRateLimits: vi.fn()
}))

vi.mock('./minimax/minimax-fetcher', () => ({
  fetchMiniMaxRateLimits: vi.fn()
}))

vi.mock('./grok-fetcher', () => ({
  fetchGrokRateLimits: vi.fn()
}))

vi.mock('./grok-auth', () => ({
  readGrokAuthSession: vi.fn(() => ({ status: 'missing' }))
}))

vi.mock('../minimax/minimax-cookie-store', () => ({
  hasMiniMaxSessionCookie: vi.fn(() => false)
}))

let directory: string
beforeEach(async () => {
  resetRateLimitProviderMocks()
  vi.mocked(fetchClaudeRateLimits).mockResolvedValue(okProvider('claude', 0))
  vi.mocked(fetchCodexRateLimits).mockResolvedValue(okProvider('codex', 0))
  directory = mkdtempSync(join(tmpdir(), 'orca-opencode-service-'))
  vi.stubEnv('XDG_DATA_HOME', directory)
  vi.stubEnv('OPENCODE_API_KEY', '')
  const actual = await vi.importActual<typeof OpenCodeGoApiKeyModule>('./opencode-go-api-key')
  vi.mocked(OpenCodeGoApiKeyModule.resolveOpenCodeGoApiKey).mockImplementation(
    actual.resolveOpenCodeGoApiKey
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})

function writeKey(key: string): void {
  mkdirSync(join(directory, 'opencode'), { recursive: true })
  writeFileSync(
    join(directory, 'opencode', 'auth.json'),
    JSON.stringify({ 'opencode-go': { type: 'api', key } })
  )
}

describe('OpenCode Go service credentials', () => {
  it.each(['setting', 'environment', 'auth-file'] as const)(
    'publishes configured status and discards stale data after a %s key change',
    async (source) => {
      const service = new RateLimitService()
      let setting = ''
      const setKey = (key: string): void => {
        if (source === 'setting') {
          setting = key
        }
        if (source === 'environment') {
          vi.stubEnv('OPENCODE_API_KEY', key)
        }
        if (source === 'auth-file') {
          writeKey(key)
        }
      }
      service.setOpenCodeGoConfigResolver(() => ({
        apiKey: setting,
        sessionCookie: '',
        workspaceIdOverride: ''
      }))
      setKey('fake-first')
      vi.mocked(fetchOpenCodeGoRateLimits).mockResolvedValue(okProvider('opencode-go', 40))
      await service.refresh()
      expect(service.getState().opencodeGoApiKeyConfigured).toBe(true)
      expect(service.getState().opencodeGo?.session?.usedPercent).toBe(40)
      expect(fetchOpenCodeGoRateLimits).toHaveBeenLastCalledWith(
        '',
        undefined,
        undefined,
        'fake-first'
      )
      expect(JSON.stringify(service.getState())).not.toContain('fake-first')

      setKey('fake-second')
      vi.mocked(fetchOpenCodeGoRateLimits).mockResolvedValue(
        errorProvider('opencode-go', 'Usage fetch failed (503)')
      )
      await service.refresh()
      expect(fetchOpenCodeGoRateLimits).toHaveBeenLastCalledWith(
        '',
        undefined,
        undefined,
        'fake-second'
      )
      expect(service.getState().opencodeGo?.session).toBeNull()
      expect(service.getState().opencodeGo?.status).toBe('error')
      service.stop()
    }
  )

  it('discards stale usage when the source changes even if the key stays equal', async () => {
    const service = new RateLimitService()
    let setting = 'fake-key'
    vi.stubEnv('OPENCODE_API_KEY', 'fake-key')
    service.setOpenCodeGoConfigResolver(() => ({
      apiKey: setting,
      sessionCookie: '',
      workspaceIdOverride: ''
    }))
    vi.mocked(fetchOpenCodeGoRateLimits).mockResolvedValue(okProvider('opencode-go', 40))
    await service.refresh()
    setting = ''
    vi.mocked(fetchOpenCodeGoRateLimits).mockResolvedValue(
      errorProvider('opencode-go', 'Usage fetch failed (503)')
    )
    await service.refresh()
    expect(service.getState().opencodeGo?.session).toBeNull()
    service.stop()
  })

  it('clears the configured flag when the local key disappears', async () => {
    const service = new RateLimitService()
    writeKey('fake-key')
    await service.refresh()
    expect(service.getState().opencodeGoApiKeyConfigured).toBe(true)
    rmSync(join(directory, 'opencode', 'auth.json'))
    await service.refresh()
    expect(service.getState().opencodeGoApiKeyConfigured).toBe(false)
    service.stop()
  })
})
