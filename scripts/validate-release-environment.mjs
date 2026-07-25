/* eslint-disable @typescript-eslint/explicit-function-return-type */
const platform = process.argv[2]
if (!['mac', 'win', 'linux'].includes(platform)) {
  throw new Error('Choose a release platform: mac, win, or linux')
}

const present = (name) => Boolean(process.env[name]?.trim())

const updateUrl = process.env.SYDEKYKS_UPDATE_URL?.trim()
if (!updateUrl) throw new Error('SYDEKYKS_UPDATE_URL is required for a release build')
const parsedUpdateUrl = new URL(updateUrl)
if (parsedUpdateUrl.protocol !== 'https:') {
  throw new Error('SYDEKYKS_UPDATE_URL must use HTTPS')
}
if (parsedUpdateUrl.username || parsedUpdateUrl.password) {
  throw new Error('Do not embed update-server credentials in SYDEKYKS_UPDATE_URL')
}

if (platform === 'mac') {
  if (!present('CSC_LINK') && !present('CSC_NAME')) {
    throw new Error('A Developer ID Application identity is required (CSC_LINK or CSC_NAME)')
  }
  const appleId = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].every(present)
  const apiKey = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'].every(present)
  const keychain = ['APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE'].every(present)
  if (!appleId && !apiKey && !keychain) {
    throw new Error(
      'Configure one notarization method: Apple ID, App Store Connect API key, or keychain profile'
    )
  }
}

if (platform === 'win') {
  const certificate = present('WIN_CSC_LINK') || present('CSC_LINK')
  const azure = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'].every(present)
  if (!certificate && !azure) {
    throw new Error('A Windows code-signing certificate or Azure Trusted Signing is required')
  }
}

console.log(
  `${platform} release environment is complete; signing is mandatory and updates use HTTPS.`
)
