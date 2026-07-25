import { listPackage } from '@electron/asar'
import { execFileSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const application = resolve(root, 'dist', 'mac-arm64', 'Sydekyks.app')
const asarPath = resolve(application, 'Contents', 'Resources', 'app.asar')
const entries = listPackage(asarPath)
const releaseConfiguration = await readFile(resolve(root, 'electron-builder.release.yml'), 'utf8')
const forbidden = [
  /^\/data\//,
  /^\/\.mastra\/output\/studio\//,
  /^\/\.mastra\/\.build\//,
  /^\/\.env(?:\.|$)/,
  /^\/src\//,
  /^\/tests\//
]
const leaked = entries.filter((entry) => forbidden.some((pattern) => pattern.test(entry)))
if (leaked.length > 0) throw new Error(`Packaged development data/assets:\n${leaked.join('\n')}`)

for (const required of [
  '/out/main/index.js',
  '/out/preload/index.js',
  '/out/renderer/index.html',
  '/.mastra/output/index.mjs'
]) {
  if (!entries.includes(required)) throw new Error(`Packaged runtime is missing ${required}`)
}

const info = JSON.parse(
  execFileSync('/usr/bin/plutil', [
    '-convert',
    'json',
    '-o',
    '-',
    resolve(application, 'Contents', 'Info.plist')
  ]).toString()
)
if (info.CFBundleIdentifier !== 'com.sydekyks.desktop') {
  throw new Error(`Unexpected bundle identifier: ${info.CFBundleIdentifier}`)
}
if (info.CFBundleDisplayName !== 'Sydekyks' && info.CFBundleName !== 'Sydekyks') {
  throw new Error('The package is not branded as Sydekyks')
}
for (const requiredReleaseSetting of [
  'forceCodeSigning: true',
  'provider: generic',
  'url: ${env.SYDEKYKS_UPDATE_URL}',
  'notarize: true'
]) {
  if (!releaseConfiguration.includes(requiredReleaseSetting)) {
    throw new Error(`Release configuration is missing ${requiredReleaseSetting}`)
  }
}
const packageSize = await stat(asarPath)
console.log(
  `Package audit passed: ${entries.length} files, ${(packageSize.size / 1024 / 1024).toFixed(1)} MB app.asar, no development data or Studio.`
)
