import { test, expect } from '../support/fixtures.ts'
import { AUTHORIZED_PASSWORD, AUTHORIZED_USERNAME } from '../support/common.ts'
import { adminClient } from '../support/admin-client.ts'

async function openWorkspace (page, appUrl, realm) {
  const url = new URL('/', appUrl)
  url.searchParams.set('realm', realm)
  await page.goto(url.toString())
}

async function signIn (page, bed) {
  await page.getByRole('button', { name: 'Sign in with local Keycloak' }).click()
  await bed.executor.submitLoginForm()
  await expect(page.locator('#auth-badge')).toHaveText('Signed in')
}

async function eventCount (page) {
  const eventUrl = new URL('/api/demo-events', page.url())
  eventUrl.searchParams.set('realm', new URL(page.url()).searchParams.get('realm') ?? '')
  const response = await page.request.get(eventUrl.toString())
  return (await response.json()).count
}

test('starts unauthenticated, gates the action, and uses real S256 login with draft recovery', async ({ page, appUrl, bed }) => {
  await openWorkspace(page, appUrl, bed.realm)
  await expect(page.locator('#auth-badge')).toHaveText('Signed out')
  await expect(page.getByRole('button', { name: 'Run synthetic preview' })).toBeDisabled()
  await page.getByLabel('Request draft').fill('Fictional handoff checklist for a local sample team.')

  let observedS256 = false
  await page.route('**/protocol/openid-connect/auth?**', async (route) => {
    const url = new URL(route.request().url())
    observedS256 = url.searchParams.get('response_type') === 'code' && url.searchParams.get('code_challenge_method') === 'S256' && Boolean(url.searchParams.get('code_challenge'))
    await route.continue()
  })
  await signIn(page, bed)
  expect(observedS256).toBe(true)
  await expect(page.getByLabel('Request draft')).toHaveValue('Fictional handoff checklist for a local sample team.')
  await expect(page.getByRole('button', { name: 'Run synthetic preview' })).toBeEnabled()
  expect(await eventCount(page)).toBe(0)
})

test('runs a protected synthetic preview only after valid session and UserInfo checks', async ({ page, appUrl, bed }) => {
  await openWorkspace(page, appUrl, bed.realm)
  await page.getByLabel('Request draft').fill('Synthetic preview item.')
  await signIn(page, bed)
  await page.getByRole('button', { name: 'Run synthetic preview' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Synthetic preview recorded in memory' })).toBeVisible()
  expect(await eventCount(page)).toBe(1)
  await expect(page.getByLabel('Request draft')).toHaveValue('')
})

test('refreshes an expiring real Keycloak session before the protected action', async ({ page, appUrl, bed }) => {
  await bed.updateRealm({ accessTokenLifespan: 15 })
  await openWorkspace(page, appUrl, bed.realm)
  await page.getByLabel('Request draft').fill('Synthetic refresh check.')
  let refreshGrants = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/protocol/openid-connect/token') && request.postData()?.includes('grant_type=refresh_token')) refreshGrants += 1
  })
  await signIn(page, bed)
  await page.getByRole('button', { name: 'Run synthetic preview' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Synthetic preview recorded in memory' })).toBeVisible()
  expect(refreshGrants).toBeGreaterThan(0)
  expect(await eventCount(page)).toBe(1)
})

test('blocks after actual access-token expiry and rejected refresh without an action effect', async ({ page, appUrl, bed }) => {
  await bed.updateRealm({ accessTokenLifespan: 5 })
  await openWorkspace(page, appUrl, bed.realm)
  await page.getByLabel('Request draft').fill('Keep this synthetic draft after refresh rejection.')
  let refreshStatus = 0
  page.on('response', (response) => {
    if (response.url().endsWith('/protocol/openid-connect/token') && response.request().postData()?.includes('grant_type=refresh_token')) refreshStatus = response.status()
  })
  await signIn(page, bed)
  const users = await adminClient.users.find({ realm: bed.realm, username: AUTHORIZED_USERNAME })
  const user = await adminClient.users.findOne({ realm: bed.realm, id: users[0].id })
  await adminClient.users.update({ realm: bed.realm, id: user.id }, { ...user, enabled: false })
  await page.waitForTimeout(6500)
  await page.getByRole('button', { name: 'Run synthetic preview' }).click()
  await expect(page.getByRole('alert')).toContainText('No synthetic preview was sent')
  expect(refreshStatus).toBe(400)
  expect(await eventCount(page)).toBe(0)
  await expect(page.getByLabel('Request draft')).toHaveValue('Keep this synthetic draft after refresh rejection.')
  await expect(page.getByRole('button', { name: 'Run synthetic preview' })).toBeDisabled()
})

test('logs out through the real local Keycloak end-session flow', async ({ page, appUrl, bed }) => {
  await openWorkspace(page, appUrl, bed.realm)
  await signIn(page, bed)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.locator('#auth-badge')).toHaveText('Signed out')
  await expect(page.getByRole('button', { name: 'Run synthetic preview' })).toBeDisabled()
})

test('rejects a mismatched state returned by the real authorization server', async ({ page, appUrl, bed }) => {
  await openWorkspace(page, appUrl, bed.realm)
  await page.getByLabel('Request draft').fill('State-fault synthetic draft.')
  await page.route('**/protocol/openid-connect/auth?**', async (route) => {
    // Labeled fault injection: preserve the real provider, change only its request state.
    const url = new URL(route.request().url())
    url.searchParams.set('state', 'fault-injected-state-mismatch')
    await route.continue({ url: url.toString() })
  })
  await page.getByRole('button', { name: 'Sign in with local Keycloak' }).click()
  await bed.executor.submitLoginForm()
  await expect(page.getByRole('alert')).toContainText('could not be verified')
  await expect(page.getByRole('button', { name: 'Run synthetic preview' })).toBeDisabled()
  expect(await eventCount(page)).toBe(0)
})

test('rejects a nonce mismatch in a mutated real token response', async ({ page, appUrl, bed }) => {
  await openWorkspace(page, appUrl, bed.realm)
  await page.route('**/protocol/openid-connect/token', async (route) => {
    // Labeled fault injection: mutate only the nonce of the real Keycloak response.
    const real = await route.fetch()
    const payload = await real.json()
    if (typeof payload.id_token === 'string') {
      const [header, encoded, signature] = payload.id_token.split('.')
      const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
      claims.nonce = 'fault-injected-wrong-nonce'
      payload.id_token = [header, Buffer.from(JSON.stringify(claims)).toString('base64url'), signature].join('.')
      await route.fulfill({ response: real, body: JSON.stringify(payload) })
      return
    }
    await route.fulfill({ response: real })
  })
  await page.getByRole('button', { name: 'Sign in with local Keycloak' }).click()
  await bed.executor.submitLoginForm()
  await expect(page.getByRole('alert')).toContainText('could not be verified')
  await expect(page.getByRole('button', { name: 'Run synthetic preview' })).toBeDisabled()
  expect(await eventCount(page)).toBe(0)
})

test('rejects a replayed real callback after its one-time state was consumed', async ({ page, appUrl, bed }) => {
  let callbackUrl = ''
  page.on('framenavigated', (frame) => {
    const hash = new URL(frame.url()).hash.slice(1)
    if (frame === page.mainFrame() && frame.url().startsWith(appUrl.origin) && new URLSearchParams(hash).has('code')) callbackUrl = frame.url()
  })
  await openWorkspace(page, appUrl, bed.realm)
  await page.getByLabel('Request draft').fill('Replayed-callback draft.')
  await signIn(page, bed)
  expect(callbackUrl.startsWith(appUrl.origin)).toBe(true)
  const callbackParams = new URLSearchParams(new URL(callbackUrl).hash.slice(1))
  expect(callbackParams.has('code')).toBe(true)
  const pendingCallbackKeys = await page.evaluate(() => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((key) => key?.startsWith('kc-callback-')).length)
  expect(pendingCallbackKeys).toBe(0)
  const cleanUrl = new URL('/', appUrl)
  cleanUrl.searchParams.set('realm', bed.realm)
  cleanUrl.searchParams.set('replay-check', 'fresh-document')
  await page.goto(cleanUrl.toString())
  await expect(page.locator('#auth-badge')).toHaveText('Signed out')
  await page.goto(callbackUrl)
  await expect(page.getByRole('alert')).toContainText('could not be verified')
  await expect(page.getByRole('button', { name: 'Run synthetic preview' })).toBeDisabled()
  expect(await eventCount(page)).toBe(0)
  await expect(page.getByLabel('Request draft')).toHaveValue('Replayed-callback draft.')
})

test('blocks a real UserInfo response whose subject does not match the session', async ({ page, appUrl, bed }) => {
  await openWorkspace(page, appUrl, bed.realm)
  await page.getByLabel('Request draft').fill('Invalid UserInfo synthetic draft.')
  await signIn(page, bed)
  await page.route('**/protocol/openid-connect/userinfo', async (route) => {
    // Labeled fault injection: mutate the subject in the fetched real provider response.
    const real = await route.fetch()
    const body = await real.json()
    body.sub = 'fault-injected-different-subject'
    await route.fulfill({ response: real, body: JSON.stringify(body) })
  })
  await page.getByRole('button', { name: 'Run synthetic preview' }).click()
  await expect(page.getByRole('alert')).toContainText('No synthetic preview was sent')
  expect(await eventCount(page)).toBe(0)
  await expect(page.getByLabel('Request draft')).toHaveValue('Invalid UserInfo synthetic draft.')
  await expect(page.getByRole('button', { name: 'Run synthetic preview' })).toBeDisabled()
})

test('blocks a late real UserInfo result after Keycloak ends the session', async ({ page, appUrl, bed }) => {
  await openWorkspace(page, appUrl, bed.realm)
  await page.getByLabel('Request draft').fill('Keep this fictional draft after a session change.')
  await signIn(page, bed)

  let signalUserInfoStarted
  let releaseUserInfo
  const userInfoStarted = new Promise((resolve) => { signalUserInfoStarted = resolve })
  const userInfoGate = new Promise((resolve) => { releaseUserInfo = resolve })
  await page.route('**/protocol/openid-connect/userinfo', async (route) => {
    const realProviderResponse = await route.fetch()
    signalUserInfoStarted()
    await userInfoGate
    try {
      await route.fulfill({ response: realProviderResponse })
    } catch {
      // Navigation or session cleanup may cancel the delayed browser response.
    }
  })

  const secondTab = await page.context().newPage()
  try {
    await page.getByRole('button', { name: 'Run synthetic preview' }).click()
    await userInfoStarted
    expect(await eventCount(page)).toBe(0)

    // A second tab uses the same synthetic Keycloak SSO cookie and ends the real session.
    await openWorkspace(secondTab, appUrl, bed.realm)
    await secondTab.getByRole('button', { name: 'Sign in with local Keycloak' }).click()
    const loginForm = secondTab.getByRole('textbox', { name: 'Username or email' })
    if (await loginForm.isVisible().catch(() => false)) {
      await loginForm.fill(AUTHORIZED_USERNAME)
      await secondTab.getByRole('textbox', { name: 'Password' }).fill(AUTHORIZED_PASSWORD)
      await secondTab.getByRole('button', { name: 'Sign In' }).click()
    }
    await expect(secondTab.locator('#auth-badge')).toHaveText('Signed in')
    await secondTab.getByRole('button', { name: 'Sign out' }).click()
    await expect(secondTab.locator('#auth-badge')).toHaveText('Signed out')
    await expect(page.locator('#auth-badge')).toHaveText('Signed out', { timeout: 15000 })

    releaseUserInfo()
    await expect(page.getByRole('alert')).toContainText('No synthetic preview was sent')
    await expect(page.locator('#identity')).toBeHidden()
    await expect(page.getByLabel('Request draft')).toHaveValue('Keep this fictional draft after a session change.')
    await expect(page.getByRole('button', { name: 'Run synthetic preview' })).toBeDisabled()
    expect(await eventCount(page)).toBe(0)
  } finally {
    releaseUserInfo()
    await secondTab.close().catch(() => {})
  }
})

test('keeps an accepted preview out of the UI after a real Keycloak logout', async ({ page, appUrl, bed }) => {
  await openWorkspace(page, appUrl, bed.realm)
  await page.getByLabel('Request draft').fill('Keep this synthetic draft after logout.')
  await signIn(page, bed)

  let signalPreviewProcessed
  let releasePreviewResponse
  const previewProcessed = new Promise((resolve) => { signalPreviewProcessed = resolve })
  const previewResponseGate = new Promise((resolve) => { releasePreviewResponse = resolve })
  await page.route('**/api/demo-operation', async (route) => {
    const acceptedResponse = await route.fetch()
    signalPreviewProcessed()
    await previewResponseGate
    try {
      await route.fulfill({ response: acceptedResponse })
    } catch {
      // The page or synthetic realm may be closing during cleanup.
    }
  })

  const secondTab = await page.context().newPage()
  try {
    await page.getByRole('button', { name: 'Run synthetic preview' }).click()
    await previewProcessed
    expect(await eventCount(page)).toBe(1)

    // A second tab ends the same real local Keycloak SSO session.
    await openWorkspace(secondTab, appUrl, bed.realm)
    await secondTab.getByRole('button', { name: 'Sign in with local Keycloak' }).click()
    const loginForm = secondTab.getByRole('textbox', { name: 'Username or email' })
    if (await loginForm.isVisible().catch(() => false)) {
      await loginForm.fill(AUTHORIZED_USERNAME)
      await secondTab.getByRole('textbox', { name: 'Password' }).fill(AUTHORIZED_PASSWORD)
      await secondTab.getByRole('button', { name: 'Sign In' }).click()
    }
    await expect(secondTab.locator('#auth-badge')).toHaveText('Signed in')
    await secondTab.getByRole('button', { name: 'Sign out' }).click()
    await expect(secondTab.locator('#auth-badge')).toHaveText('Signed out')
    await expect(page.locator('#auth-badge')).toHaveText('Signed out', { timeout: 15000 })
    await expect(page.getByRole('alert')).toContainText(/outcome may be unknown/i)

    releasePreviewResponse()
    await expect(page.getByRole('alert')).toContainText(/may already have been recorded/i)
    expect(await eventCount(page)).toBe(1)
    await expect(page.getByLabel('Request draft')).toHaveValue('Keep this synthetic draft after logout.')
    await expect(page.locator('#identity')).toBeHidden()
    await expect(page.locator('#feedback')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Run synthetic preview' })).toBeDisabled()
  } finally {
    releasePreviewResponse()
    await secondTab.close().catch(() => {})
  }
})

test('reports an unknown result when a processed preview response is lost', async ({ page, appUrl, bed }) => {
  await openWorkspace(page, appUrl, bed.realm)
  await page.getByLabel('Request draft').fill('Keep this synthetic draft after a lost response.')
  await signIn(page, bed)

  let acceptedByLocalServer = false
  let dispatchedRequests = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/api/demo-operation')) dispatchedRequests += 1
  })
  await page.route('**/api/demo-operation', async (route) => {
    // Labeled transport fault: let the real local endpoint accept the preview, then drop only its browser response.
    const acceptedResponse = await route.fetch()
    const acceptedBody = await acceptedResponse.json()
    acceptedByLocalServer = acceptedResponse.status() === 202 && acceptedBody.accepted === true && acceptedBody.count === 1
    await route.abort('failed')
  })

  await page.getByRole('button', { name: 'Run synthetic preview' }).click()
  await expect(page.getByRole('alert')).toContainText(/result could not be confirmed/i)
  expect(acceptedByLocalServer).toBe(true)
  expect(dispatchedRequests).toBe(1)
  expect(await eventCount(page)).toBe(1)
  await expect(page.getByRole('alert')).toContainText(/may already have been recorded/i)
  await expect(page.getByLabel('Request draft')).toHaveValue('Keep this synthetic draft after a lost response.')
  await expect(page.locator('#feedback')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Run synthetic preview' })).toBeDisabled()
})

test('keeps tokens out of the app DOM, application storage, and console messages', async ({ page, appUrl, bed }) => {
  const consoleMessages = []
  page.on('console', (message) => consoleMessages.push(message.text()))
  await openWorkspace(page, appUrl, bed.realm)
  await signIn(page, bed)
  const observations = await page.evaluate(() => {
    const tokenLike = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/
    const documentMarkup = document.documentElement.outerHTML
    const sessionEntries = Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index)
      return [key, sessionStorage.getItem(key) ?? '']
    })
    const localEntries = Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index)
      return [key, localStorage.getItem(key) ?? '']
    })
    return {
      tokenLikeInDom: tokenLike.test(documentMarkup),
      tokenLikeInSessionStorage: tokenLike.test(JSON.stringify(sessionEntries)),
      tokenLikeInLocalStorage: tokenLike.test(JSON.stringify(localEntries)),
      applicationSessionKeysOnly: sessionEntries.every(([key]) => key === 'oidc-business-app.synthetic-draft.v1')
    }
  })
  expect(observations).toEqual({ tokenLikeInDom: false, tokenLikeInSessionStorage: false, tokenLikeInLocalStorage: false, applicationSessionKeysOnly: true })
  expect(consoleMessages.some((message) => /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(message))).toBe(false)
})
