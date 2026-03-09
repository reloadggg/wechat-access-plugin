import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const targetRoot = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.openclaw', 'extensions', 'wechat-access')

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

console.log(`Installed wechat-access plugin to ${targetRoot}`)
