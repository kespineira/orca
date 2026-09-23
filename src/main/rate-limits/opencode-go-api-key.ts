import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readNodeFileSyncWithinLimit } from '../../shared/node-bounded-file-reader'

const MAX_AUTH_FILE_BYTES = 1_000_000

export type OpenCodeGoApiKey = {
  source: 'setting' | 'environment' | 'auth-file'
  key: string
}

export function resolveOpenCodeGoApiKeys(setting?: string): OpenCodeGoApiKey[] {
  if (setting?.trim()) {
    return [{ source: 'setting', key: setting.trim() }]
  }
  const candidates: OpenCodeGoApiKey[] = []
  const environmentKey = process.env.OPENCODE_API_KEY?.trim()
  const authFileKey = readOpenCodeGoAuthFileKey()
  // Why: an equal key is sent once, but as the Go-specific auth-file source so a 403 stays visible.
  if (environmentKey && environmentKey !== authFileKey?.key) {
    candidates.push({ source: 'environment', key: environmentKey })
  }
  if (authFileKey) {
    candidates.push(authFileKey)
  }
  return candidates
}

function readOpenCodeGoAuthFileKey(): OpenCodeGoApiKey | null {
  try {
    // Why: OpenCode uses xdg-basedir on every OS, including Windows.
    const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
    const text = readNodeFileSyncWithinLimit(
      join(dataHome, 'opencode', 'auth.json'),
      MAX_AUTH_FILE_BYTES
    ).buffer.toString('utf8')
    const auth: unknown = JSON.parse(text)
    if (typeof auth !== 'object' || auth === null || !('opencode-go' in auth)) {
      return null
    }
    const entry = auth['opencode-go']
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('type' in entry) ||
      entry.type !== 'api' ||
      !('key' in entry) ||
      typeof entry.key !== 'string' ||
      !entry.key.trim()
    ) {
      return null
    }
    return { source: 'auth-file', key: entry.key.trim() }
  } catch {
    return null
  }
}

export function getOpenCodeGoConfigHash(
  apiKeys: readonly OpenCodeGoApiKey[],
  cookie: string,
  workspaceId: string
): string {
  return createHash('sha256')
    .update(JSON.stringify([apiKeys, cookie, workspaceId]))
    .digest('hex')
}
