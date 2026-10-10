# Local OIDC Business App Example

A small source-derived demo of a business-style browser flow. A user signs in through a locally running Keycloak server, keeps a fictional request draft through the redirect, and can preview it after the adapter refresh and UserInfo identity checks succeed.

Start with the [flow](#quick-demonstration) and [complete local setup](example/README.md). The authored [browser flow](example/public/app.js) and [Express endpoint](example/server/app.js) are exercised by [selected Chromium tests](example/test/tests/business-app.spec.ts). [Design notes](example/DESIGN.md), [CI scope](docs/CI.md), and [source provenance](PROVENANCE.json) explain the inherited adapter and verification boundary.

## Quick demonstration

The page begins signed out. After local sign-in, the page shows the verified identity and enables a synthetic preview. The Express endpoint increments an in-memory counter for the selected realm; it does not retain the draft or identity. If the request is accepted but its response is lost, the UI keeps the draft and reports an unknown result. The server-side counter may already have changed, so a retry is not automatically safe.

## Run locally

Use Java 25, the official Keycloak 26.8.0 distribution, Node.js 24.18.0, npm 11.16.0, and Playwright 1.62.1 with Chromium. The recorded browser run used Eclipse Temurin 25.0.4.1+1. Start Keycloak separately on loopback, then follow the complete [setup and run instructions](example/README.md).

From `example/`, install the locked dependencies and run the selected browser suite:

```sh
npm ci
npx playwright install chromium
npm test
```

`npm test` starts only the Express demo. It does not install Chromium, provision Keycloak, or start the identity provider. Use synthetic local accounts and fictional text only.

## Source and derivation

[`copied-component/`](copied-component/) contains the exact 66 tracked files from [`keycloak/keycloak-js`](https://github.com/keycloak/keycloak-js/tree/8803e6b54a4ba6f9dc0150d0329c98e7902a9ee8), commit `8803e6b54a4ba6f9dc0150d0329c98e7902a9ee8`, under Apache-2.0. The browser imports `keycloak-js` through the import map in `example/public/index.html`; the executing file is `example/lib/keycloak.js`, an exact copy of `copied-component/lib/keycloak.js`. Its declaration and deprecation files are copied alongside it, as is the exact, lazy-loaded DPoP module needed to resolve that adapter import. This demo does not enable DPoP. [`PROVENANCE.json`](PROVENANCE.json) records every component Git blob, source mode, byte count, SHA-256, current app-derived hash, and adapter path mapping.

## Verification

A later single run in the retained local environment started Keycloak once; discovery returned HTTP 200 with the master issuer and advertised S256. The selected Chromium suite ran once through npm test on one worker: 13 selected, 13 passed, with no failures or skips (40.7 seconds reported by Playwright; wrapper exit 0 after 41.444 seconds). The run targeted the v1 staged app. Separate curation evidence records that the v2 app, test, and component bytes match that tested stage; this v3 copy preserves them. Post-run readback matched recorded hashes for all 88 projected source paths (774,417 bytes) and verified the 66 exact component Git blobs. These checks cover the recorded projection, not every runtime or workspace file; dependencies were not reinstalled. The observed realm list contained only master; cleanup evidence records that the owned provider stopped, ports 3000/8080/9000 closed, two owned H2 files were removed, and the owned H2 path was absent. This is evidence for the selected Chromium cases in a retained environment, not a fresh-machine setup check, another-browser run, or a full upstream-suite pass.

The separate full upstream baseline recorded 187 passed and 8 failed out of 195 for both the original source and its exact copy. The same eight Firefox cross-origin DPoP cases failed on `ENOTFOUND kjs-auth.localhost`. These are partial, environment-limited results, not a full-suite pass. `PROVENANCE.json` records the baseline and historical cleanup correction.

## Scope and limits

The preview is a client-side gate followed by an unauthenticated local endpoint. It is not backend authorization, idempotency, or business processing. A preview may be accepted before a response is lost; the UI cannot undo that effect. A real service needs server-side token validation and authorization, plus idempotency or reconciliation before safe retries. This example makes no production-readiness or security-proof claim.

The paper fit is narrow: [the CSF 2017 proceedings record](https://ieeexplore.ieee.org/abstract/document/8049720) and the authors' [longer arXiv version 1](https://arxiv.org/abs/1704.08539v1) discuss OIDC authentication and session-integrity reasoning. The reviewed arXiv text is the longer version; it is distinct from the abridged conference publication. Those results motivate attention to state, response rejection, and session lifecycle; they do not evaluate this Keycloak release or prove this application secure.
