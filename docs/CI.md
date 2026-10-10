# OIDC integration CI

This workflow addition reuses the CI/test setup from the exact copied Keycloak JS component at commit 8803e6b54a4ba6f9dc0150d0329c98e7902a9ee8, under Apache-2.0. The references are copied-component/.github/workflows/main.yml, copied-component/.github/actions/setup/action.yml and copied-component/test/README.md. Their effective pattern is checkout, Node setup, locked installation, browser installation, a disposable provider and the browser suite.

The repository-root workflow targets the existing example/ application and its selected Chromium suite. It does not run the separate upstream lint, guides or full 195-case baseline. The nested copied-component workflows remain unchanged.

## Runtime and isolation

The workflow selects Ubuntu 24.04 and Node 24.18.0, uses the existing npm lockfile, and installs only the selected Playwright Chromium browser and its system dependencies. The official Keycloak 26.8.0 container manifest is pinned by digest. It binds only the runner's loopback port 8080, uses the synthetic administrator already declared by the test fixture, and is removed by an always-run cleanup step. No real account, repository secret, confidential input or external identity-provider tenant is required. The job has a 15-minute limit; discovery has a bounded wait and checks the expected master issuer and S256 before running the suite.

The checkout and setup-node references are exact commits resolved from the same upstream v6/v4 action families. The workflow grants contents:read and disables persisted checkout credentials. It does not publish artifacts or deploy an application.

## Verification boundary

The public source's earlier local result is 13/13 selected Chromium tests in a retained distribution-based environment. This new container-based hosted workflow has not been run or proven equivalent to that environment. Static workflow and shell checks are recorded separately in the private review packet; they are not a hosted test pass. A passing CI badge should be added only after observing the first real run.

The existing root README's application limits, reviewed-paper fit, historical baseline failures and security boundaries still apply. This workflow does not add backend authorization, idempotency or a production deployment.

## Primary implementation references

- [Pinned upstream CI](https://github.com/keycloak/keycloak-js/blob/8803e6b54a4ba6f9dc0150d0329c98e7902a9ee8/.github/workflows/main.yml)
- [Pinned upstream test setup](https://github.com/keycloak/keycloak-js/blob/8803e6b54a4ba6f9dc0150d0329c98e7902a9ee8/test/README.md)
- [Keycloak's container development-mode example](https://www.keycloak.org/server/containers)
- [GitHub Actions workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [Official Ubuntu 24.04 runner inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)

Pinned Keycloak index: sha256:b0f60d489d51c5d113390bdf5461d4c06e6051be026c05549f2e1e10ec352bcc. Its digest matched the fetched manifest bytes; publisher signatures were not verified.
Pinned actions: checkout d23441a48e516b6c34aea4fa41551a30e30af803; setup-node 49933ea5288caeca8642d1e84afbd3f7d6820020.

