/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { readFile } from 'node:fs/promises'

const cssUrl = new URL('../src/renderer/src/assets/main.css', import.meta.url)
const css = await readFile(cssUrl, 'utf8')
const root = css.match(/:root\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body

if (!root) {
  throw new Error('Could not find the shared :root color tokens.')
}

function token(name) {
  const value = root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`))?.[1]
  if (!value) throw new Error(`Missing six-digit color token --${name}.`)
  return value
}

const typographyTokens = {
  'font-micro': '0.75rem',
  'font-caption': '0.8125rem',
  'font-support': '0.875rem',
  'font-ui': '0.9375rem',
  'font-body': '1rem'
}

for (const [name, expected] of Object.entries(typographyTokens)) {
  const value = root.match(new RegExp(`--${name}:\\s*([^;]+)\\s*;`))?.[1]?.trim()
  if (value !== expected) {
    throw new Error(`Expected --${name} to be ${expected}; received ${value ?? 'nothing'}.`)
  }
}

const fixedPixelFontSizes = css.match(/font-size:\s*\d+(?:\.\d+)?px/g) ?? []
if (fixedPixelFontSizes.length > 0) {
  throw new Error(
    `Use the shared rem typography scale instead of fixed pixel text: ${fixedPixelFontSizes.join(', ')}.`
  )
}

function luminance(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

const darkSurfaces = ['canvas', 'surface', 'surface-raised']
const checks = []

for (const foreground of ['text', 'text-muted', 'text-soft']) {
  for (const background of darkSurfaces) {
    checks.push({
      label: `--${foreground} on --${background}`,
      ratio: contrast(token(foreground), token(background)),
      minimum: 4.5
    })
  }
}

checks.push({
  label: '--placeholder on input background',
  ratio: contrast(token('placeholder'), '#0c0c0c'),
  minimum: 4.5
})

for (const foreground of [
  'primary',
  'primary-light',
  'secondary',
  'success',
  'danger',
  'warning'
]) {
  for (const background of darkSurfaces) {
    checks.push({
      label: `--${foreground} on --${background}`,
      ratio: contrast(token(foreground), token(background)),
      minimum: 3
    })
  }
}

for (const foreground of ['border-strong', 'border-control']) {
  for (const background of darkSurfaces) {
    checks.push({
      label: `--${foreground} on --${background}`,
      ratio: contrast(token(foreground), token(background)),
      minimum: 3
    })
  }
}

for (const background of ['primary', 'primary-light']) {
  checks.push({
    label: `primary button text on --${background}`,
    ratio: contrast('#26140c', token(background)),
    minimum: 4.5
  })
}

const failures = checks.filter(({ ratio, minimum }) => ratio < minimum)

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(
      `${failure.label}: ${failure.ratio.toFixed(2)}:1 (needs ${failure.minimum.toFixed(1)}:1)`
    )
  }
  process.exitCode = 1
} else {
  const lowestText = Math.min(
    ...checks.filter(({ minimum }) => minimum === 4.5).map(({ ratio }) => ratio)
  )
  const lowestUi = Math.min(
    ...checks.filter(({ minimum }) => minimum === 3).map(({ ratio }) => ratio)
  )
  console.log(
    `UI accessibility passed: rem typography scale verified; lowest text pair ${lowestText.toFixed(2)}:1; lowest UI pair ${lowestUi.toFixed(2)}:1.`
  )
}
