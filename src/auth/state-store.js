import { readFileSync, writeFileSync, unlinkSync, mkdirSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

const DEFAULT_STATE_PATH = join(homedir(), '.openclaw', 'wechat-access-auth.json')

export function getStatePath(customPath) {
  return customPath || DEFAULT_STATE_PATH
}

export function loadState(customPath) {
  const filePath = getStatePath(customPath)
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function saveState(state, customPath) {
  const filePath = getStatePath(customPath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(state, null, 2), { encoding: 'utf-8', mode: 0o600 })
  try {
    chmodSync(filePath, 0o600)
  } catch {
    // Windows may not support chmod
  }
}

export function clearState(customPath) {
  const filePath = getStatePath(customPath)
  try {
    unlinkSync(filePath)
  } catch {
    // file not found — ignore
  }
}
