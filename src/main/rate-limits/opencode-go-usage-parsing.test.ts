import { describe, expect, it } from 'vitest'
import { parseOpenCodeGoUsagePayload } from './opencode-go-status-parsing'

const window = { status: 'ok', percent: 0, resetsAt: '2026-09-23T19:49:40.024Z' }
function payload(rolling: unknown = window): string {
  return JSON.stringify({ usage: { rolling, weekly: window, monthly: window } })
}

describe('OpenCode Go API usage parsing', () => {
  it('preserves percentages as percentages, including rate-limited windows', () => {
    const parsed = parseOpenCodeGoUsagePayload(
      payload({ ...window, status: 'rate-limited', percent: 0.5 })
    )
    expect(parsed?.session.usedPercent).toBe(0.5)
    expect(parsed?.weekly.usedPercent).toBe(0)
    expect(parsed?.monthly?.windowMinutes).toBe(43200)
  })

  it.each([
    null,
    [],
    {},
    { ...window, status: 'unknown' },
    { ...window, percent: '50' },
    { ...window, percent: null }
  ])('rejects malformed windows %j', (value) => {
    expect(parseOpenCodeGoUsagePayload(payload(value))).toBeNull()
  })

  it('rejects malformed, oversized, and incomplete payloads', () => {
    for (const text of [
      '',
      '{bad',
      ' '.repeat(1_000_001),
      '{}',
      '{"usage":{}}',
      JSON.stringify({ usage: { rolling: window, monthly: window } }),
      JSON.stringify({ usage: { weekly: window, monthly: window } })
    ]) {
      expect(parseOpenCodeGoUsagePayload(text)).toBeNull()
    }
  })

  it('parses session and weekly usage without a monthly window', () => {
    const parsed = parseOpenCodeGoUsagePayload(
      JSON.stringify({ usage: { rolling: window, weekly: window } })
    )
    expect(parsed?.session.usedPercent).toBe(0)
    expect(parsed?.weekly.usedPercent).toBe(0)
    expect(parsed?.monthly).toBeNull()
  })

  it('omits an invalid reset date', () => {
    expect(
      parseOpenCodeGoUsagePayload(payload({ ...window, resetsAt: 'invalid' }))?.session.resetsAt
    ).toBeNull()
  })
})
