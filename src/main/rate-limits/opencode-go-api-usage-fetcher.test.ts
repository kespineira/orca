import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchOpenCodeGoRateLimits } from './opencode-go-usage-fetcher'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  setCookie: vi.fn(),
  clear: vi.fn(),
  proxy: vi.fn(),
  resolveProxy: vi.fn()
}))
vi.mock('electron', () => ({
  session: {
    fromPartition: () => ({
      fetch: mocks.fetch,
      cookies: { set: mocks.setCookie },
      clearStorageData: mocks.clear,
      setProxy: mocks.proxy,
      resolveProxy: mocks.resolveProxy,
      closeAllConnections: async () => undefined
    })
  }
}))

const fakeKey = 'oc_sk_fake-private-key'
const reset = '2026-09-23T19:49:40.024Z'
const usage = {
  usage: {
    rolling: { status: 'ok', percent: 25, resetsAt: reset },
    weekly: { status: 'ok', percent: -10, resetsAt: reset },
    monthly: { status: 'rate-limited', percent: 120, resetsAt: reset }
  }
}
const cookieUsage = {
  access: {
    meters: {
      fiveHour: { usedMicroCents: 1, limitMicroCents: 10, resetsAt: reset },
      week: { usedMicroCents: 2, limitMicroCents: 10, resetsAt: reset }
    }
  }
}
function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.resolveProxy.mockResolvedValue('DIRECT')
  vi.stubEnv('HTTPS_PROXY', '')
  vi.stubEnv('https_proxy', '')
  vi.stubEnv('HTTP_PROXY', '')
  vi.stubEnv('http_proxy', '')
  vi.stubEnv('ALL_PROXY', '')
  vi.stubEnv('all_proxy', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('OpenCode Go API usage', () => {
  it.each([200, 403])(
    'tries an auth-file key after an env 403, with auth-file HTTP %i',
    async (status) => {
      mocks.fetch
        .mockResolvedValueOnce(response({}, 403))
        .mockResolvedValueOnce(response(usage, status))
      const result = await fetchOpenCodeGoRateLimits('', undefined, undefined, [
        { key: 'fake-env-key', source: 'environment' },
        { key: 'fake-auth-file-key', source: 'auth-file' }
      ])
      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      expect(mocks.fetch.mock.calls[1]?.[1].headers.Authorization).toBe('Bearer fake-auth-file-key')
      expect(result.apiKeyConfigured).toBe(true)
      expect(result.status).toBe(status === 200 ? 'ok' : 'error')
      expect(result.session?.usedPercent ?? null).toBe(status === 200 ? 25 : null)
    }
  )

  it.each([200, 401, 503])('does not try the auth-file key after env HTTP %i', async (status) => {
    mocks.fetch.mockResolvedValue(response(usage, status))
    await fetchOpenCodeGoRateLimits('', undefined, undefined, [
      { key: 'fake-env-key', source: 'environment' },
      { key: 'fake-auth-file-key', source: 'auth-file' }
    ])
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it.each(['environment', 'setting', 'auth-file'] as const)(
    'treats a 403 from %s according to its Go-specific configuration',
    async (source) => {
      mocks.fetch.mockResolvedValue(response({ error: { name: 'EntitlementError' } }, 403))
      const result = await fetchOpenCodeGoRateLimits('', undefined, undefined, [
        { key: fakeKey, source }
      ])
      expect(result.status).toBe(source === 'environment' ? 'unavailable' : 'error')
      expect(result.apiKeyConfigured).toBe(source !== 'environment')
      expect(result.session).toBeNull()
    }
  )

  it.each([200, 401])(
    'tries the cookie after an environment key gets 403, with cookie HTTP %i',
    async (status) => {
      mocks.fetch
        .mockResolvedValueOnce(response({}, 403))
        .mockResolvedValueOnce(response(cookieUsage, status))
      const result = await fetchOpenCodeGoRateLimits('auth=fake-cookie', 'wrk_legacy', undefined, [
        { key: fakeKey, source: 'environment' }
      ])
      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      expect(mocks.fetch.mock.calls[1]?.[0]).toBe('https://opencode.ai/console/api/go/status')
      expect(result.apiKeyConfigured).toBe(false)
      expect(result.status).toBe(status === 200 ? 'ok' : 'error')
    }
  )

  it('uses bearer auth without cookies or workspace discovery and clamps all usage windows', async () => {
    mocks.fetch.mockResolvedValue(response(usage))
    const result = await fetchOpenCodeGoRateLimits('auth=fake-cookie', 'wrk_unused', undefined, [
      { key: fakeKey, source: 'setting' }
    ])
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(
      'https://opencode.ai/zen/go/v1/usage',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: `Bearer ${fakeKey}`, Accept: 'application/json' },
        credentials: 'omit',
        redirect: 'error'
      })
    )
    expect(mocks.setCookie).not.toHaveBeenCalled()
    expect(mocks.clear).toHaveBeenCalled()
    expect(result).toMatchObject({
      status: 'ok',
      error: null,
      session: { usedPercent: 25, windowMinutes: 300, resetsAt: Date.parse(reset) },
      weekly: { usedPercent: 0, windowMinutes: 10080 },
      monthly: { usedPercent: 100, windowMinutes: 43200 }
    })
  })

  it.each([
    [
      401,
      'OpenCode Go API key is missing or invalid. Reconnect with /connect in OpenCode or paste an API key in settings.'
    ],
    [403, 'OpenCode Go subscription required.'],
    [500, 'Usage fetch failed (500)'],
    [503, 'Usage fetch failed (503)']
  ])('maps HTTP %i without echoing response secrets', async (status, error) => {
    mocks.fetch.mockResolvedValue(response({ error: fakeKey }, status))
    const result = await fetchOpenCodeGoRateLimits('', undefined, undefined, [
      { key: fakeKey, source: 'setting' }
    ])
    expect(result.error).toBe(error)
    expect(JSON.stringify(result)).not.toContain(fakeKey)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it.each([401, 403, 500])('falls back to a configured cookie after HTTP %i', async (status) => {
    mocks.fetch
      .mockResolvedValueOnce(response({}, status))
      .mockResolvedValueOnce(response(cookieUsage))
    const result = await fetchOpenCodeGoRateLimits('auth=fake-cookie', 'wrk_legacy', undefined, [
      { key: fakeKey, source: 'setting' }
    ])
    expect(result.status).toBe('ok')
    expect(result.session?.usedPercent).toBe(10)
    expect(mocks.setCookie).toHaveBeenCalledWith(expect.objectContaining({ value: 'fake-cookie' }))
    expect(mocks.fetch.mock.calls[1]?.[1].headers).not.toHaveProperty('Authorization')
  })

  it('retains the actionable key error when the cookie also fails', async () => {
    mocks.fetch.mockResolvedValueOnce(response({}, 401)).mockResolvedValueOnce(response({}, 403))
    const result = await fetchOpenCodeGoRateLimits('auth=fake-cookie', 'wrk_legacy', undefined, [
      { key: fakeKey, source: 'setting' }
    ])
    expect(result.error).toContain('/connect')
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })

  it('uses the cookie directly when there is no API key', async () => {
    mocks.fetch.mockResolvedValue(response(cookieUsage))
    expect((await fetchOpenCodeGoRateLimits('auth=fake-cookie', 'wrk_legacy')).status).toBe('ok')
    expect(mocks.fetch.mock.calls[0]?.[0]).toBe('https://opencode.ai/console/api/go/status')
  })

  it('uses Orca proxy settings for API requests', async () => {
    mocks.fetch.mockResolvedValue(response(usage))
    await fetchOpenCodeGoRateLimits(
      '',
      undefined,
      { httpProxyUrl: 'http://proxy.example:8080', httpProxyBypassRules: 'localhost' },
      [{ key: fakeKey, source: 'setting' }]
    )
    expect(mocks.proxy).toHaveBeenCalledWith({
      mode: 'fixed_servers',
      proxyRules: 'http://proxy.example:8080',
      proxyBypassRules: 'localhost'
    })
  })

  it('bridges environment proxies for API requests', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://env-proxy.example:8080')
    mocks.fetch.mockResolvedValue(response(usage))
    await fetchOpenCodeGoRateLimits('', undefined, undefined, [{ key: fakeKey, source: 'setting' }])
    expect(mocks.proxy).toHaveBeenCalledWith(
      expect.objectContaining({ proxyRules: 'http://env-proxy.example:8080' })
    )
  })

  it('does not expose transport errors that contain the key', async () => {
    mocks.fetch.mockRejectedValue(new Error(`Authorization: Bearer ${fakeKey}`))
    const result = await fetchOpenCodeGoRateLimits('', undefined, undefined, [
      { key: fakeKey, source: 'setting' }
    ])
    expect(result.status).toBe('error')
    expect(result.error).toContain('connection and proxy')
    expect(JSON.stringify(result)).not.toContain(fakeKey)
  })
})
