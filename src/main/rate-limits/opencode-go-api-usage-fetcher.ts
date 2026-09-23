import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import type { NetworkProxySettings } from '../../shared/network-proxy'
import { createOpenCodeRequestSession, OPENCODE_BASE_URL } from './opencode-go-request-session'
import { parseOpenCodeGoUsagePayload } from './opencode-go-status-parsing'

function usageError(error: string): ProviderRateLimits {
  return {
    provider: 'opencode-go',
    session: null,
    weekly: null,
    monthly: null,
    updatedAt: Date.now(),
    error,
    status: 'error'
  }
}

export async function fetchOpenCodeGoApiUsage(
  apiKey: string,
  networkProxySettings?: NetworkProxySettings
): Promise<ProviderRateLimits> {
  try {
    const requestSession = await createOpenCodeRequestSession([], networkProxySettings)
    const response = await requestSession.fetch(`${OPENCODE_BASE_URL}/zen/go/v1/usage`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000)
    })
    if (response.status === 401) {
      return usageError(
        'OpenCode Go API key is missing or invalid. Reconnect with /connect in OpenCode or paste an API key in settings.'
      )
    }
    if (response.status === 403) {
      return usageError('OpenCode Go subscription required.')
    }
    if (!response.ok) {
      return usageError(`Usage fetch failed (${response.status})`)
    }
    const parsed = parseOpenCodeGoUsagePayload(await response.text())
    return parsed
      ? { provider: 'opencode-go', ...parsed, updatedAt: Date.now(), error: null, status: 'ok' }
      : usageError('Could not parse OpenCode Go usage data')
  } catch {
    // Why: transport errors can contain request headers, including the API key.
    return usageError('OpenCode Go usage request failed. Check your connection and proxy settings.')
  }
}
