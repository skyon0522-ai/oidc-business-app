import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const authServerUrl = new URL(process.env.OIDC_AUTH_SERVER_URL ?? 'http://127.0.0.1:8080')
const host = '127.0.0.1'
const port = Number(process.env.PORT ?? 3000)
const operations = new Map()

if (!['127.0.0.1', 'localhost', '[::1]'].includes(authServerUrl.hostname)) {
  throw new Error('This local demo accepts only a loopback Keycloak URL.')
}

app.disable('x-powered-by')
app.get('/healthz', (_request, response) => response.json({ status: 'ok' }))
app.use('/lib', express.static(path.join(root, 'lib'), { fallthrough: false, immutable: true, maxAge: '1h' }))
app.use(express.static(path.join(root, 'public'), { index: 'index.html' }))

app.get('/adapter-config.json', (request, response) => {
  const realm = request.query.realm
  if (typeof realm !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(realm)) {
    response.status(400).json({ error: 'Provide a valid synthetic local realm name.' })
    return
  }

  response.set('Cache-Control', 'no-store').json({
    'auth-server-url': authServerUrl.origin,
    realm,
    resource: 'keycloak-js-test-client'
  })
})

app.use('/api', express.json({ limit: '2kb', type: 'application/json' }))
app.get('/api/demo-events', (request, response) => {
  const realm = request.query.realm
  if (typeof realm !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(realm)) {
    response.status(400).json({ error: 'Provide a valid synthetic local realm name.' })
    return
  }
  response.json({ count: operations.get(realm) ?? 0 })
})
app.post('/api/demo-operation', (request, response) => {
  const { operation, draft, realm } = request.body ?? {}
  if (operation !== 'draft-preview' || typeof realm !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(realm) || typeof draft !== 'string' || draft.trim().length === 0 || draft.length > 280) {
    response.status(400).json({ error: 'Expected a valid synthetic realm and non-empty draft of at most 280 characters.' })
    return
  }

  // This in-memory counter is the only effect. It does not retain the draft or identity.
  const count = (operations.get(realm) ?? 0) + 1
  operations.set(realm, count)
  response.status(202).json({ accepted: true, count, kind: 'synthetic-preview' })
})

const server = app.listen(port, host)
server.on('error', (error) => {
  console.error(`Local demo server failed to start: ${error.message}`)
  process.exitCode = 1
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)))
}
