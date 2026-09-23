import { ipcMain } from 'electron'
import {
  clearOpenCodeGoApiKey,
  hasOpenCodeGoApiKey,
  saveOpenCodeGoApiKey
} from '../opencode/opencode-go-api-key-store'
import type { RateLimitService } from '../rate-limits/service'

type CredentialRateLimits = Pick<
  RateLimitService,
  'invalidateOpenCodeGoCredentialState' | 'refresh'
>

function getOpenCodeGoCredentialsStatus(): { apiKeyConfigured: boolean } {
  return { apiKeyConfigured: hasOpenCodeGoApiKey() }
}

// Why: report persisted status immediately while usage refreshes in the background.
function refreshAfterOpenCodeGoCredentialChange(rateLimits: CredentialRateLimits | null): void {
  rateLimits?.invalidateOpenCodeGoCredentialState()
  void rateLimits?.refresh().catch((error: unknown) => {
    console.error('[opencode-go] failed to refresh usage after a credential change:', error)
  })
}

export function registerOpenCodeGoCredentialsHandlers(
  rateLimits: CredentialRateLimits | null
): void {
  ipcMain.handle('opencodeGoCredentials:getStatus', () => getOpenCodeGoCredentialsStatus())
  ipcMain.handle('opencodeGoCredentials:saveApiKey', (_event, key: unknown) => {
    if (typeof key !== 'string') {
      throw new Error('OpenCode Go API key must be a string')
    }
    saveOpenCodeGoApiKey(key)
    refreshAfterOpenCodeGoCredentialChange(rateLimits)
    return getOpenCodeGoCredentialsStatus()
  })
  ipcMain.handle('opencodeGoCredentials:clearApiKey', () => {
    clearOpenCodeGoApiKey()
    refreshAfterOpenCodeGoCredentialChange(rateLimits)
    return getOpenCodeGoCredentialsStatus()
  })
}
