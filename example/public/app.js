import Keycloak from 'keycloak-js'

const DRAFT_KEY = 'oidc-business-app.synthetic-draft.v1'
const draft = document.querySelector('#draft')
const draftCount = document.querySelector('#draft-count')
const authStatus = document.querySelector('#auth-status')
const authBadge = document.querySelector('#auth-badge')
const identity = document.querySelector('#identity')
const loginButton = document.querySelector('#login')
const logoutButton = document.querySelector('#logout')
const actionButton = document.querySelector('#protected-action')
const actionState = document.querySelector('#action-state')
const errorRegion = document.querySelector('#error')
const feedbackRegion = document.querySelector('#feedback')
let adapter
let authenticated = false
let gateBlocked = false
let busy = false
let logoutPending = false
let actionGeneration = 0
let actionInFlightDispatched = false

function showError (message) {
  errorRegion.textContent = message
  errorRegion.hidden = false
  feedbackRegion.hidden = true
}

function showFeedback (message) {
  feedbackRegion.textContent = message
  feedbackRegion.hidden = false
  errorRegion.hidden = true
}

function updateControls () {
  loginButton.disabled = busy || logoutPending || authenticated
  logoutButton.hidden = !authenticated
  logoutButton.disabled = logoutPending
  actionButton.disabled = busy || logoutPending || !authenticated || gateBlocked || draft.value.trim().length === 0
}

function updateDraftCount () {
  draftCount.textContent = `${draft.value.length} / 280`
}

function setAuthState (state, message) {
  authenticated = state === 'signed-in' && adapter?.authenticated === true
  authBadge.dataset.state = state === 'blocked' ? 'blocked' : state
  authBadge.textContent = state === 'signed-in' ? 'Signed in' : state === 'blocked' ? 'Blocked' : state === 'checking' ? 'Checking' : 'Signed out'
  authStatus.textContent = message
  identity.hidden = !authenticated
  identity.textContent = authenticated ? `Verified local Keycloak subject: ${adapter.subject}` : ''
  actionState.textContent = gateBlocked
    ? 'Blocked until a fresh sign-in succeeds.'
    : authenticated
      ? 'Ready: refresh and UserInfo checks run again before each preview.'
      : 'Available after a verified local sign-in.'
  updateControls()
}

function readDraft () {
  try {
    draft.value = sessionStorage.getItem(DRAFT_KEY) ?? ''
  } catch {
    showError('This browser tab cannot retain the synthetic draft across the sign-in redirect.')
  }
  updateDraftCount()
}

draft.addEventListener('input', () => {
  updateDraftCount()
  try {
    sessionStorage.setItem(DRAFT_KEY, draft.value)
  } catch {
    showError('The draft could not be saved in this browser tab; it may not survive a sign-in redirect.')
  }
  updateControls()
})

document.querySelector('#clear-draft').addEventListener('click', () => {
  draft.value = ''
  try {
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    showError('The draft could not be cleared from this browser tab.')
  }
  updateDraftCount()
  updateControls()
})

loginButton.addEventListener('click', async () => {
  if (!adapter || busy) return
  busy = true
  updateControls()
  authStatus.textContent = 'Opening the local Keycloak sign-in page…'
  try {
    await adapter.login({ redirectUri: location.href })
  } catch {
    busy = false
    showError('Sign-in could not be started. Your synthetic draft remains in this tab.')
    updateControls()
  }
})

logoutButton.addEventListener('click', async () => {
  if (!adapter || logoutPending) return
  logoutPending = true
  actionGeneration += 1
  updateControls()
  try {
    await adapter.logout({ redirectUri: location.href })
  } catch {
    logoutPending = false
    showError('Sign-out did not complete. Your synthetic draft remains in this tab.')
    updateControls()
  }
})

actionButton.addEventListener('click', async () => {
  if (!adapter || !authenticated || gateBlocked || busy || draft.value.trim().length === 0) return
  busy = true
  actionInFlightDispatched = false
  updateControls()
  errorRegion.hidden = true
  feedbackRegion.hidden = true
  const generation = ++actionGeneration
  const sessionSubject = adapter.subject
  const assertSessionCurrent = () => {
    if (generation !== actionGeneration || adapter.authenticated !== true || adapter.subject !== sessionSubject) {
      throw new Error('The sign-in session changed while the preview was being prepared.')
    }
  }

  try {
    // The official guide's service-call example must return on this error path.
    await adapter.updateToken(30)
    assertSessionCurrent()

    const userInfo = await adapter.loadUserInfo()
    assertSessionCurrent()
    if (typeof userInfo?.sub !== 'string' || userInfo.sub.length === 0 || userInfo.sub !== adapter.subject) {
      throw new Error('The local UserInfo subject did not match the authenticated session.')
    }
    assertSessionCurrent()

    actionInFlightDispatched = true
    const response = await fetch('/api/demo-operation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'draft-preview', realm: adapter.realm, draft: draft.value })
    })
    assertSessionCurrent()
    if (!response.ok) throw new Error('The synthetic preview endpoint rejected the request.')

    const result = await response.json()
    assertSessionCurrent()
    if (result.accepted !== true || result.kind !== 'synthetic-preview') throw new Error('The preview response was not recognized.')

    actionInFlightDispatched = false
    let savedDraftCleared = true
    try {
      sessionStorage.removeItem(DRAFT_KEY)
    } catch {
      savedDraftCleared = false
    }
    if (savedDraftCleared) {
      draft.value = ''
      updateDraftCount()
      showFeedback('Synthetic preview recorded in memory. The draft was cleared from this tab.')
    } else {
      gateBlocked = true
      setAuthState('signed-in', 'The preview was recorded, but the saved draft could not be cleared. Sign out before continuing.')
      showError('Preview recorded. The saved draft remains in this tab; clear it manually before signing out.')
    }
  } catch {
    const requestWasDispatched = actionInFlightDispatched
    gateBlocked = true
    const stillSignedIn = adapter.authenticated === true
    setAuthState(stillSignedIn ? 'signed-in' : 'blocked', requestWasDispatched
      ? stillSignedIn
        ? 'The preview request may have been sent, but its outcome could not be confirmed. It may already have been recorded.'
        : 'The session ended after the preview request may have been sent. Its outcome may be unknown; sign in again before continuing.'
      : stillSignedIn
        ? 'The response or preview could not be verified. Sign out and sign in again before retrying.'
        : 'The session could not be refreshed. No preview was sent; sign in again to continue.')
    showError(requestWasDispatched
      ? 'The preview request may have been sent, but its result could not be confirmed. It may already have been recorded. The draft remains in this tab; do not assume a retry is safe.'
      : 'Action blocked. No synthetic preview was sent, and the draft remains in this tab.')
  } finally {
    busy = false
    actionInFlightDispatched = false
    updateControls()
  }
})

async function initialize () {
  readDraft()
  setAuthState('checking', 'Checking the local sign-in state…')
  const initialHash = new URLSearchParams(location.hash.slice(1))
  const hasOAuthCallback = (initialHash.has('code') || initialHash.has('error')) && initialHash.has('state')
  const realm = new URL(location.href).searchParams.get('realm')
  if (!realm || !/^[A-Za-z0-9_-]{1,80}$/.test(realm)) {
    gateBlocked = true
    setAuthState('blocked', 'A valid synthetic local realm is required.')
    showError('Open this page with the realm created by the local test fixture.')
    return
  }

  try {
    const configResponse = await fetch(`/adapter-config.json?realm=${encodeURIComponent(realm)}`, { cache: 'no-store' })
    if (!configResponse.ok) throw new Error('Local adapter configuration could not be loaded.')
    const config = await configResponse.json()
    adapter = new Keycloak({
      url: config['auth-server-url'],
      realm: config.realm,
      clientId: config.resource
    })
    adapter.onAuthLogout = () => {
      actionGeneration += 1
      gateBlocked = true
      setAuthState('signed-out', 'The local Keycloak session ended. Sign in again before continuing.')
      showError(actionInFlightDispatched
        ? 'A preview request may have been sent before the session ended. Its outcome may be unknown; the draft remains in this tab.'
        : 'The sign-in session ended. Sign in again before continuing.')
    }
    const ready = await adapter.init({ pkceMethod: 'S256' })
    gateBlocked = hasOAuthCallback && !ready
    setAuthState(ready ? 'signed-in' : 'signed-out', ready
      ? 'Signed in through the local Keycloak server.'
      : gateBlocked
        ? 'The sign-in response was rejected; no preview is available.'
        : 'Not signed in. The preview stays unavailable until sign-in succeeds.')
    if (gateBlocked) showError('The sign-in response could not be verified. No preview is available.')
  } catch {
    gateBlocked = true
    setAuthState('blocked', 'The sign-in response could not be verified.')
    showError('Sign-in initialization failed; the response could not be verified. No protected action is available; the draft remains in this tab.')
  }
}

await initialize()
