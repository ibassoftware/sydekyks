/* eslint-disable @typescript-eslint/no-require-imports */
const { app } = require('electron')

app.setName(process.env.SYDEKYKS_CREDENTIAL_PROFILE || 'electron-chat')
console.log('Starting the secure Electron credential test…')
app
  .whenReady()
  .then(() => import('./test-stored-live-connections.mjs'))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Electron test bootstrap failed')
    app.exit(1)
  })
