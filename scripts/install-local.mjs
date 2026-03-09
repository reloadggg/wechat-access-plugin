import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

function resolveOpenClawHome() {
  if (process.env.OPENCLAW_HOME) {
    return path.resolve(process.env.OPENCLAW_HOME)
  }
  return path.join(process.env.USERPROFILE || process.env.HOME || '.', '.openclaw')
}

const targetRoot = path.join(resolveOpenClawHome(), 'extensions', 'openclaw-wechat-access-plugin')

const entriesToCopy = [
  'openclaw.plugin.json',
  'package.json',
  'index.js',
  'src'
]

async function copyRecursive(source, target) {
  const stat = await fs.stat(source)
  if (stat.isDirectory()) {
    await fs.mkdir(target, { recursive: true })
    const names = await fs.readdir(source)
    for (const name of names) {
      await copyRecursive(path.join(source, name), path.join(target, name))
    }
    return
  }
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(source, target)
}

await fs.mkdir(targetRoot, { recursive: true })
for (const entry of entriesToCopy) {
  await copyRecursive(path.join(projectRoot, entry), path.join(targetRoot, entry))
}

console.log(`Installed openclaw-wechat-access-plugin to ${targetRoot}`)
