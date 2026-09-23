/* oxlint-disable anti-slop/no-module-mocking -- Vitest support module for the RateLimitService specs, not shipped code,
   and it falls outside the *.test / *.spec / tests glob set. The service resolves the OpenCode Go key from the host's
   env and auth.json directly, so one shared stub keeps every spec off a developer's real credentials. */
// Import this setup before the service so credential mocks register first.
import { EventEmitter } from 'node:events'
import { afterEach, expect, vi, type Mock } from 'vitest'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import type { RateLimitService } from './service'
import { fetchCodexRateLimits } from './codex-fetcher'
import { fetchGeminiRateLimits } from './gemini-usage-fetcher'
import { fetchKimiRateLimits } from './kimi-fetcher'
import { fetchMiniMaxRateLimits } from './minimax/minimax-fetcher'
import { fetchGrokRateLimits } from './grok-fetcher'
import { readGrokAuthSession } from './grok-auth'
import { fetchOpenCodeGoRateLimits } from './opencode-go-usage-fetcher'
import { hasMiniMaxSessionCookie } from '../minimax/minimax-cookie-store'
import * as OpenCodeGoApiKeyModule from './opencode-go-api-key'

vi.mock('./opencode-go-api-key', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenCodeGoApiKeyModule>()),
  resolveOpenCodeGoApiKeys: vi.fn(() => [])
}))

const inheritedOpenCodeApiKey = process.env.OPENCODE_API_KEY?.trim()
afterEach(() => {
  if (inheritedOpenCodeApiKey) {
    // Check a boolean so assertion failures cannot print a developer's key.
    expect(
      vi
        .mocked(fetchOpenCodeGoRateLimits)
        .mock.calls.some((call) => call[3]?.some(({ key }) => key === inheritedOpenCodeApiKey))
    ).toBe(false)
  }
})

export type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

export async function flushMicrotasks(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve()
  }
}

export function okProvider(
  provider: ProviderRateLimits['provider'],
  usedPercent: number,
  updatedAt = Date.now()
): ProviderRateLimits {
  return {
    provider,
    session: {
      usedPercent,
      windowMinutes: 300,
      resetsAt: null,
      resetDescription: null
    },
    weekly: null,
    updatedAt,
    error: null,
    status: 'ok'
  }
}

export function errorProvider(
  provider: ProviderRateLimits['provider'],
  message: string
): ProviderRateLimits {
  return {
    provider,
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    error: message,
    status: 'error'
  }
}

export function unavailableProvider(
  provider: ProviderRateLimits['provider'],
  message = 'Not configured'
): ProviderRateLimits {
  return {
    provider,
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    error: message,
    status: 'unavailable'
  }
}

// Why: beforeEach caches snapshot objects whose updatedAt is pinned at suite
// start, so after 5 fake minutes every healthy provider looks stale and every
// activation degrades to a full fetch. Backoff tests that reason about the
// individual retry lane need healthy providers minted fresh at fetch time.
export function mockFreshBackgroundProviderFetches(): void {
  vi.mocked(fetchCodexRateLimits).mockImplementation(async () => okProvider('codex', 24))
  vi.mocked(fetchGeminiRateLimits).mockImplementation(async () => okProvider('gemini', 0))
  vi.mocked(fetchOpenCodeGoRateLimits).mockImplementation(async () => okProvider('opencode-go', 0))
  vi.mocked(fetchKimiRateLimits).mockImplementation(async () => okProvider('kimi', 0))
  vi.mocked(fetchMiniMaxRateLimits).mockImplementation(async () => okProvider('minimax', 0))
  vi.mocked(fetchGrokRateLimits).mockImplementation(async () => unavailableProvider('grok'))
}

/** Shared `beforeEach` body: healthy stubs for every provider the service polls. */
export function resetRateLimitProviderMocks(): void {
  vi.clearAllMocks()
  vi.mocked(OpenCodeGoApiKeyModule.resolveOpenCodeGoApiKeys).mockReturnValue([])
  vi.mocked(fetchGeminiRateLimits).mockResolvedValue(okProvider('gemini', 0, Date.now()))
  vi.mocked(fetchOpenCodeGoRateLimits).mockResolvedValue(okProvider('opencode-go', 0, Date.now()))
  vi.mocked(fetchKimiRateLimits).mockResolvedValue(okProvider('kimi', 0, Date.now()))
  vi.mocked(fetchMiniMaxRateLimits).mockResolvedValue(okProvider('minimax', 0, Date.now()))
  vi.mocked(fetchGrokRateLimits).mockResolvedValue({
    provider: 'grok',
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    error: null,
    status: 'unavailable'
  })
  vi.mocked(hasMiniMaxSessionCookie).mockReturnValue(false)
  vi.mocked(readGrokAuthSession).mockReturnValue({ status: 'missing' })
}

type RateLimitWindow = Parameters<RateLimitService['attach']>[0]

export type FakeWindowWebContents = {
  send: Mock<(channel: string, ...args: unknown[]) => void>
}

export class FakeRateLimitWindow extends EventEmitter {
  focused = true
  minimized = false
  visible = true

  webContents: FakeWindowWebContents = {
    send: vi.fn()
  }

  isDestroyed(): boolean {
    return false
  }

  isVisible(): boolean {
    return this.visible
  }

  isMinimized(): boolean {
    return this.minimized
  }

  isFocused(): boolean {
    return this.focused
  }
}

export function asRateLimitWindow(window: FakeRateLimitWindow): RateLimitWindow {
  return window as unknown as RateLimitWindow
}
