import {
  deferred,
  errorProvider,
  okProvider,
  resetRateLimitProviderMocks
} from './rate-limit-service-test-harness'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { RateLimitService } from './service'
import { fetchClaudeRateLimits } from './claude-fetcher'
import { fetchCodexRateLimits } from './codex-fetcher'
import { fetchOpenCodeGoRateLimits } from './opencode-go-usage-fetcher'
import type * as OpenCodeGoUsageModule from './opencode-go-usage-fetcher'
import * as OpenCodeGoApiKeyModule from './opencode-go-api-key'

const requestFetch = vi.hoisted(() => vi.fn())
vi.mock('./opencode-go-request-session', () => ({
  OPENCODE_BASE_URL: 'https://opencode.ai',
  createOpenCodeRequestSession: vi.fn(async () => ({ fetch: requestFetch })),
  clearOpenCodeSessionCookies: vi.fn(async () => undefined)
}))

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
  requestFetch.mockReset()
  vi.mocked(fetchClaudeRateLimits).mockResolvedValue(okProvider('claude', 0))
  vi.mocked(fetchCodexRateLimits).mockResolvedValue(okProvider('codex', 0))
  directory = mkdtempSync(join(tmpdir(), 'orca-opencode-service-'))
  vi.stubEnv('XDG_DATA_HOME', directory)
  vi.stubEnv('OPENCODE_API_KEY', '')
  const actual = await vi.importActual<typeof OpenCodeGoApiKeyModule>('./opencode-go-api-key')
  vi.mocked(OpenCodeGoApiKeyModule.resolveOpenCodeGoApiKeys).mockImplementation(
    actual.resolveOpenCodeGoApiKeys
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

async function useRealOpenCodeFetcher(): Promise<void> {
  const actual = await vi.importActual<typeof OpenCodeGoUsageModule>('./opencode-go-usage-fetcher')
  vi.mocked(fetchOpenCodeGoRateLimits).mockImplementation(actual.fetchOpenCodeGoRateLimits)
}

describe('OpenCode Go service credentials', () => {
  it('isolates unreadable stored keys without leaking decryption errors', async () => {
    await useRealOpenCodeFetcher()
    const service = new RateLimitService()
    service.setOpenCodeGoConfigResolver(
      () => ({ sessionCookie: '', workspaceIdOverride: '' }),
      () => {
        throw new Error('fake-private-key')
      }
    )
    await service.refresh()
    expect(service.getState().opencodeGo?.status).toBe('error')
    expect(service.getState().opencodeGo?.error).toBe(
      'OpenCode Go API key could not be decrypted. Re-enter or clear the key in Settings.'
    )
    expect(service.getState().claude?.status).toBe('ok')
    expect(requestFetch).not.toHaveBeenCalled()
    expect(JSON.stringify(service.getState())).not.toContain('fake-private-key')
    service.stop()
  })

  it.each(['cookie', 'environment', 'auth-file'] as const)(
    'uses the %s after the stored key cannot be decrypted',
    async (source) => {
      await useRealOpenCodeFetcher()
      const service = new RateLimitService()
      service.setOpenCodeGoConfigResolver(
        () => ({
          sessionCookie: source === 'cookie' ? 'auth=fake-cookie' : '',
          workspaceIdOverride: 'wrk_cookie'
        }),
        () => {
          throw new Error('fake-private-key')
        }
      )
      if (source === 'environment') {
        vi.stubEnv('OPENCODE_API_KEY', 'fake-env')
      }
      if (source === 'auth-file') {
        writeKey('fake-file')
      }
      const meter = { usedMicroCents: 3, limitMicroCents: 10, resetsAt: null }
      requestFetch.mockResolvedValue(
        new Response(
          JSON.stringify(
            source === 'cookie'
              ? { access: { meters: { fiveHour: meter, week: meter } } }
              : {
                  usage: {
                    rolling: { status: 'ok', percent: 30 },
                    weekly: { status: 'ok', percent: 40 }
                  }
                }
          )
        )
      )
      await service.refresh()
      const state = service.getState()
      expect(state.opencodeGo?.status).toBe('ok')
      expect(state.opencodeGo?.session?.usedPercent).toBe(30)
      expect(state.opencodeGoApiKeyConfigured).toBe(source !== 'cookie')
      expect(state.claude?.status).toBe('ok')
      expect(requestFetch).toHaveBeenCalledTimes(1)
      if (source === 'cookie') {
        expect(requestFetch.mock.calls[0]?.[1].headers['x-org-id']).toBe('wrk_cookie')
      } else {
        expect(requestFetch.mock.calls[0]?.[1].headers.Authorization).toBe(
          source === 'environment' ? 'Bearer fake-env' : 'Bearer fake-file'
        )
      }
      expect(JSON.stringify(state)).not.toContain('fake-private-key')
      service.stop()
    }
  )

  it('shows the decrypt error after every configured fallback fails', async () => {
    await useRealOpenCodeFetcher()
    vi.stubEnv('OPENCODE_API_KEY', 'fake-env')
    writeKey('fake-file')
    const service = new RateLimitService()
    service.setOpenCodeGoConfigResolver(
      () => ({ sessionCookie: 'auth=fake-cookie', workspaceIdOverride: 'wrk_cookie' }),
      () => {
        throw new Error('fake-private-key')
      }
    )
    requestFetch.mockImplementation(async () => new Response('{}', { status: 403 }))
    await service.refresh()
    expect(requestFetch).toHaveBeenCalledTimes(3)
    expect(service.getState().opencodeGo?.status).toBe('error')
    expect(service.getState().opencodeGo?.error).toContain('Re-enter or clear the key in Settings')
    expect(JSON.stringify(service.getState())).not.toContain('fake-private-key')
    service.stop()
  })

  it.each([200, 403])(
    'publishes the auth-file result after an env 403, with auth-file HTTP %i',
    async (status) => {
      await useRealOpenCodeFetcher()
      vi.stubEnv('OPENCODE_API_KEY', 'fake-env')
      writeKey('fake-file')
      requestFetch.mockResolvedValueOnce(new Response('{}', { status: 403 })).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            usage: { rolling: { status: 'ok', percent: 30 }, weekly: { status: 'ok', percent: 40 } }
          }),
          {
            status
          }
        )
      )
      const service = new RateLimitService()
      await service.refresh()
      expect(service.getState().opencodeGoApiKeyConfigured).toBe(true)
      expect(service.getState().opencodeGo?.status).toBe(status === 200 ? 'ok' : 'error')
      expect(service.getState().opencodeGo?.session?.usedPercent ?? null).toBe(
        status === 200 ? 30 : null
      )
      expect(requestFetch.mock.calls[1]?.[1].headers.Authorization).toBe('Bearer fake-file')
      service.stop()
    }
  )

  it('keeps a rejected environment key unconfigured during subsequent polls', async () => {
    vi.stubEnv('OPENCODE_API_KEY', 'fake-zen-key')
    const service = new RateLimitService()
    vi.mocked(fetchOpenCodeGoRateLimits).mockResolvedValue({
      ...errorProvider('opencode-go', 'OpenCode Go subscription required.'),
      status: 'unavailable',
      apiKeyConfigured: false
    })
    await service.refresh()
    expect(service.getState().opencodeGoApiKeyConfigured).toBe(false)
    expect(service.getState().opencodeGo?.status).toBe('unavailable')
    expect(service.getState().opencodeGo).not.toHaveProperty('apiKeyConfigured')
    const pending = deferred<ProviderRateLimits>()
    vi.mocked(fetchOpenCodeGoRateLimits).mockReturnValueOnce(pending.promise)
    const polling = service.refresh()
    await Promise.resolve()
    expect(service.getState().opencodeGoApiKeyConfigured).toBe(false)
    pending.resolve({
      ...errorProvider('opencode-go', 'OpenCode Go subscription required.'),
      status: 'unavailable'
    })
    await polling
    service.stop()
  })

  it.each(['key', 'cookie', 'workspace'])(
    'discards an in-flight result after a %s change',
    async (credential) => {
      const service = new RateLimitService()
      const config = {
        apiKey: 'fake-first',
        sessionCookie: 'auth=fake-cookie',
        workspaceIdOverride: 'wrk_first'
      }
      service.setOpenCodeGoConfigResolver(() => config)
      const first = deferred<ProviderRateLimits>()
      const second = deferred<ProviderRateLimits>()
      vi.mocked(fetchOpenCodeGoRateLimits)
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
      const firstRefresh = service.refresh()
      await vi.waitFor(() => expect(fetchOpenCodeGoRateLimits).toHaveBeenCalledTimes(1))
      if (credential === 'key') {
        config.apiKey = ''
      }
      if (credential === 'cookie') {
        config.sessionCookie = ''
      }
      if (credential === 'workspace') {
        config.workspaceIdOverride = 'wrk_second'
      }
      service.invalidateOpenCodeGoCredentialState()
      expect(service.getState().opencodeGo?.session).toBeNull()
      expect(service.getState().opencodeGo?.status).toBe('fetching')
      const queuedRefresh = service.refresh()
      first.resolve(okProvider('opencode-go', 50))
      await vi.waitFor(() => expect(fetchOpenCodeGoRateLimits).toHaveBeenCalledTimes(2))
      expect(service.getState().opencodeGo?.session).toBeNull()
      expect(service.getState().opencodeGo?.status).toBe('fetching')
      second.resolve(okProvider('opencode-go', 10))
      await firstRefresh
      await queuedRefresh
      expect(service.getState().opencodeGo?.session?.usedPercent).toBe(10)
      service.stop()
    }
  )

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
      expect(fetchOpenCodeGoRateLimits).toHaveBeenLastCalledWith('', undefined, undefined, [
        { key: 'fake-first', source }
      ])
      expect(JSON.stringify(service.getState())).not.toContain('fake-first')

      setKey('fake-second')
      vi.mocked(fetchOpenCodeGoRateLimits).mockResolvedValue(
        errorProvider('opencode-go', 'Usage fetch failed (503)')
      )
      await service.refresh()
      expect(fetchOpenCodeGoRateLimits).toHaveBeenLastCalledWith('', undefined, undefined, [
        { key: 'fake-second', source }
      ])
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
