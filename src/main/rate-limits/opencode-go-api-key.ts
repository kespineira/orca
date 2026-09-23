import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readNodeFileSyncWithinLimit } from '../../shared/node-bounded-file-reader'

const MAX_AUTH_FILE_BYTES = 1_000_000

export type OpenCodeGoApiKey = {
  source: 'setting' | 'environment' | 'auth-file'
  key: string
}

export function resolveOpenCodeGoApiKey(setting?: string): OpenCodeGoApiKey | null {
  if (setting?.trim()) {
    return { source: 'setting', key: setting.trim() }
  }
  const environmentKey = process.env.OPENCODE_API_KEY?.trim()
  if (environmentKey) {
    return { source: 'environment', key: environmentKey }
  }
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
  apiKey: OpenCodeGoApiKey | null,
  cookie: string,
  workspaceId: string
): string {
  return createHash('sha256')
    .update(JSON.stringify([apiKey?.source, apiKey?.key, cookie, workspaceId]))
    .digest('hex')
}
