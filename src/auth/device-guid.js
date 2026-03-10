import { randomUUID, createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

const GUID_FILE = join(homedir(), '.openclaw', 'wechat-access-guid')

/**
 * Get persistent device GUID.
 * First run generates a random MD5 GUID and saves to ~/.openclaw/wechat-access-guid.
 * Subsequent runs load from file.
 */
export function getDeviceGuid() {
  try {
    const existing = readFileSync(GUID_FILE, 'utf-8').trim()
    if (existing) return existing
  } catch {
    // file doesn't exist, generate new
  }

  const guid = createHash('md5').update(randomUUID()).digest('hex')

  try {
    mkdirSync(dirname(GUID_FILE), { recursive: true })
    writeFileSync(GUID_FILE, guid, 'utf-8')
  } catch {
    // write failure is non-fatal
  }

  return guid
}
