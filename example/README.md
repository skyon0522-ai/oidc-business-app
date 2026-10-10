# Business request workspace — local SSO example

This local example extends Keycloak's pinned JavaScript-adapter test app into a small synthetic business flow. It reuses the exact adapter source pinned in this repository and the upstream Admin Client/Playwright testbed patterns. This is an example application, not a deployable authorization system.

## Prerequisites and test setup

The browser tests were run with Node 24.18.0, npm 11.16.0, Java 25, the official Keycloak 26.8.0 distribution, and Playwright Chromium. Keycloak and the browser must be installed and started separately. The Playwright config starts only the Express demo on 127.0.0.1:3000; it does not start or configure Keycloak or download a browser.

From the official Keycloak distribution directory, start a disposable local server with a synthetic bootstrap administrator whose credentials match the local test settings in `test/support/common.ts`:

Set the two shell variables in this command locally to disposable synthetic values that match the test harness. The values are intentionally not included in this README.

```sh
KC_BOOTSTRAP_ADMIN_USERNAME="$KC_BOOTSTRAP_ADMIN_USERNAME" \
KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_BOOTSTRAP_ADMIN_PASSWORD" \
KC_HEALTH_ENABLED=true ./bin/kc.sh start-dev \
  --http-host=127.0.0.1 --http-port=8080 --http-management-port=9000
```

Then, from this candidate directory, install the locked JavaScript dependencies, install Chromium if it is not already available, and run the selected integration suite:

```sh
npm ci
npx playwright install chromium
npm test
```

The test fixture creates and deletes synthetic realms and users through the local Keycloak Admin API. Use only a disposable local instance and synthetic data.

## Run the app manually

Use the local Keycloak server and Node/npm versions listed above. From this example directory, run `npm ci` and `npm start`. The default server URLs are loopback only. Create a synthetic realm and public client with redirect URI `http://127.0.0.1:3000/*`, web origin `http://127.0.0.1:3000`, and client ID `keycloak-js-test-client`. Then start this app and open:

`http://127.0.0.1:3000/?realm=<synthetic-realm>`

The app uses the authorization-code flow with S256 PKCE. It runs adapter refresh and retrieves the provider's UserInfo response before it sends the client-side-gated preview. The preview endpoint intentionally has no server-side authorization: it increments an in-memory counter and retains neither the draft nor identity. Do not use personal, customer, or confidential text.

The only application data persisted across a redirect is the clearly synthetic draft in this tab's `sessionStorage`. The Keycloak adapter keeps access and refresh tokens in memory. The application never displays, persists, or logs token values. Its browser gate is not server authorization.

## Tests

`npm test` runs the 13 selected actual-browser integration cases against a separately running local Keycloak server, creates synthetic realms/users, and deletes each realm after the case. It does not provision Keycloak or install browsers. The tests include explicitly labeled response-fault injection against real local responses; successful login and refresh cases use the unmodified provider. The local synthetic effect is only the preview counter.

## License and derivation

The local adapter files and copied component retain their Apache-2.0 notices. See [source provenance](../PROVENANCE.json) for pinned files, Git blob IDs, current derived hashes, and adapter path mapping; [DESIGN.md](DESIGN.md) records the inspected UI reference and interaction choices.
