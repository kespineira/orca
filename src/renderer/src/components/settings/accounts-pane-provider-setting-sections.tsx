import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import { GeminiIcon, OpenCodeGoIcon } from '../status-bar/icons'
import { SearchableSetting } from './SearchableSetting'
import type { AccountsPaneSectionModel } from './accounts-pane-types'
import { DebouncedSettingsTextInput } from './DebouncedSettingsTextInput'

export function renderGeminiAccountsSection(model: AccountsPaneSectionModel): React.JSX.Element {
  const { localAccountRuntimeSentenceLabel, recordFeatureInteraction, settings, updateSettings } =
    model
  return (
    <section key="gemini" id="accounts-gemini" className="space-y-4 scroll-mt-6">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <GeminiIcon size={16} />
          {translate('auto.components.settings.AccountsPane.0c64dc2a64', 'Gemini')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.AccountsPane.973741a871',
            'Configure Gemini provider settings.'
          )}
        </p>
      </div>

      <SearchableSetting
        title={translate(
          'auto.components.settings.AccountsPane.0c7f915b01',
          'Use Gemini CLI credentials'
        )}
        description={translate(
          'auto.components.settings.AccountsPane.d676c41fc6',
          'Extracts OAuth credentials from your local Gemini CLI installation to authenticate with Google. This uses credentials issued to the Gemini CLI app, not Orca. May break if Google updates the CLI. Use at your own risk.'
        )}
        keywords={[
          'gemini',
          'cli',
          'oauth',
          'credentials',
          'experimental',
          'rate limit',
          'status bar'
        ]}
        className="flex items-center justify-between gap-4 py-2"
      >
        <div className="space-y-0.5">
          <Label>
            {translate(
              'auto.components.settings.AccountsPane.96f3649526',
              'Use Gemini CLI credentials (experimental)'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.AccountsPane.c2aee76420',
              'Extracts OAuth credentials from your local Gemini CLI installation to authenticate with Google for {{value0}}. This uses credentials issued to the Gemini CLI app, not Orca. May break if Google updates the CLI. Use at your own risk.',
              { value0: localAccountRuntimeSentenceLabel }
            )}
          </p>
        </div>
        <Switch
          aria-label={translate(
            'auto.components.settings.AccountsPane.96f3649526',
            'Use Gemini CLI credentials (experimental)'
          )}
          checked={settings.geminiCliOAuthEnabled}
          onCheckedChange={(checked) => {
            recordFeatureInteraction('usage-tracking')
            updateSettings({
              geminiCliOAuthEnabled: checked
            })
          }}
        />
      </SearchableSetting>
    </section>
  )
}

export function renderOpenCodeAccountsSection(model: AccountsPaneSectionModel): React.JSX.Element {
  const { recordFeatureInteraction, recordOpenCodeSettingEdit, settings, updateSettings } = model
  return (
    <section key="opencode-go" id="accounts-opencode-go" className="space-y-4 scroll-mt-6">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <OpenCodeGoIcon size={16} />
          {translate('auto.components.settings.AccountsPane.4ac10b4d08', 'OpenCode Go')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.AccountsPane.ea631977b5',
            'Configure OpenCode Go provider settings.'
          )}
        </p>
      </div>

      <SearchableSetting
        title={translate('settings.accounts.openCodeGo.apiKeyTitle', 'OpenCode Go API key')}
        description={translate(
          'settings.accounts.openCodeGo.apiKeyHelp',
          'Orca auto-detects the API key saved by /connect in OpenCode on this computer. Paste a key here to override it.'
        )}
        keywords={['opencode', 'api key', 'connect', 'rate limit', 'status bar']}
        className="space-y-2"
      >
        <Label htmlFor="opencode-go-api-key">
          {translate('settings.accounts.openCodeGo.apiKeyLabel', 'API key')}
        </Label>
        <div className="flex gap-2">
          <DebouncedSettingsTextInput
            id="opencode-go-api-key"
            type="password"
            value={settings.opencodeGoApiKey ?? ''}
            onEdit={() => recordOpenCodeSettingEdit('apiKey')}
            commit={(opencodeGoApiKey) => updateSettings({ opencodeGoApiKey })}
            placeholder={translate(
              'settings.accounts.openCodeGo.apiKeyPlaceholder',
              'Leave blank to auto-detect'
            )}
            spellCheck={false}
            className="flex-1 text-xs"
          />
          {settings.opencodeGoApiKey && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                recordFeatureInteraction('usage-tracking')
                updateSettings({ opencodeGoApiKey: '' })
              }}
            >
              {translate('auto.components.settings.AccountsPane.b398b834c9', 'Clear')}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {translate(
            'settings.accounts.openCodeGo.apiKeyHelp',
            'Orca auto-detects the API key saved by /connect in OpenCode on this computer. Paste a key here to override it.'
          )}
        </p>
      </SearchableSetting>

      <SearchableSetting
        title={translate(
          'settings.accounts.openCodeGo.cookieTitle',
          'OpenCode Go legacy session cookie'
        )}
        description={translate(
          'settings.accounts.openCodeGo.cookieHelp',
          'Legacy fallback for Black and legacy accounts. Paste the full Cookie header from opencode.ai browser DevTools, including __Host-console_session.'
        )}
        keywords={['opencode', 'cookie', 'session', 'console', 'rate limit', 'status bar']}
        className="space-y-2"
      >
        <Label>
          {translate('settings.accounts.openCodeGo.cookieLabel', 'Legacy session cookie')}
        </Label>
        <div className="flex gap-2">
          <DebouncedSettingsTextInput
            type="password"
            value={settings.opencodeSessionCookie}
            onEdit={() => recordOpenCodeSettingEdit('cookie')}
            commit={(opencodeSessionCookie) => updateSettings({ opencodeSessionCookie })}
            placeholder={translate(
              'auto.components.settings.AccountsPane.37b4b4a3f7',
              'auth=…; __Host-console_session=…'
            )}
            spellCheck={false}
            className="flex-1 text-xs"
          />
          {settings.opencodeSessionCookie && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                recordFeatureInteraction('usage-tracking')
                updateSettings({ opencodeSessionCookie: '' })
              }}
              className="h-7 shrink-0 text-xs text-muted-foreground hover:text-foreground"
            >
              {translate('auto.components.settings.AccountsPane.b398b834c9', 'Clear')}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {translate(
            'settings.accounts.openCodeGo.cookieHelp',
            'Legacy fallback for Black and legacy accounts. Paste the full Cookie header from opencode.ai browser DevTools, including __Host-console_session.'
          )}
        </p>
      </SearchableSetting>

      <SearchableSetting
        title={translate(
          'auto.components.settings.AccountsPane.02cb127710',
          'OpenCode Go Workspace ID'
        )}
        description={translate(
          'settings.accounts.openCodeGo.workspaceHelp',
          'Only used by the cookie fallback when automatic workspace lookup fails. Find the workspace ID in the legacy console URL. API keys do not need it.'
        )}
        keywords={['opencode', 'workspace', 'id', 'wrk', 'rate limit', 'status bar']}
        className="space-y-2"
      >
        <Label>
          {translate('auto.components.settings.AccountsPane.dbdb0b0bd8', 'Workspace ID override')}
        </Label>
        <div className="flex gap-2">
          <DebouncedSettingsTextInput
            type="text"
            value={settings.opencodeWorkspaceId}
            onEdit={() => recordOpenCodeSettingEdit('workspaceId')}
            commit={(opencodeWorkspaceId) => updateSettings({ opencodeWorkspaceId })}
            placeholder={translate(
              'auto.components.settings.AccountsPane.a122332371',
              'wrk_… (leave blank for automatic lookup)'
            )}
            spellCheck={false}
            className="flex-1 text-xs"
          />
          {settings.opencodeWorkspaceId && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                recordFeatureInteraction('usage-tracking')
                updateSettings({ opencodeWorkspaceId: '' })
              }}
              className="h-7 shrink-0 text-xs text-muted-foreground hover:text-foreground"
            >
              {translate('auto.components.settings.AccountsPane.b398b834c9', 'Clear')}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {translate(
            'settings.accounts.openCodeGo.workspaceHelp',
            'Only used by the cookie fallback when automatic workspace lookup fails. Find the workspace ID in the legacy console URL. API keys do not need it.'
          )}
        </p>
      </SearchableSetting>
    </section>
  )
}
