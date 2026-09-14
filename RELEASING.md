# Releasing

Publishing is a maintainer action. The steps below happen locally; the tag push
is what triggers `.github/workflows/publish.yml`, and that workflow is the only
thing that ever runs `npm publish`.

## The first release is the odd one out

Trusted Publishing is configured on a **package's** settings page on npmjs.com,
and that page does not exist until the package does. So the first release cannot
use it. Publish `v0.1.0` with a token, then switch to Trusted Publishing and
delete the token. Both paths produce the same provenance attestation — it is
signed by GitHub's OIDC infrastructure, which is why `publish.yml` requests
`id-token: write` either way.

**The name is free.** `npm view n8n-nodes-transcodely version` answered
`E404 Not Found` on 2026-09-14. Re-run that check before claiming it; a 404 still
means unclaimed, and any other answer means somebody got there first and the
package name in `package.json` has to change.

### 1. Publish v0.1.0 with a token (Option B)

1. On npmjs.com: **Access Tokens → Generate New Token → Granular Access Token**.
   Give it **Read and write** package permission. The package does not exist yet,
   so it cannot be selected by name — scope the token to *all packages* owned by
   the publishing account, or to an org scope. Set the shortest expiry that covers
   the release.
2. In GitHub: **Settings → Secrets and variables → Actions → New repository
   secret**, named `NPM_TOKEN`.
3. Cut the release as described under "Cutting a release" below. The workflow
   finds `NPM_TOKEN`, writes it to `.npmrc` and runs
   `npm publish --provenance --access public`.
4. Confirm the release appears on npmjs.com and that the version page shows the
   provenance panel linking back to this repository and the publishing run.

### 2. Switch to Trusted Publishing, then remove the token

Do this immediately after the first successful publish, so no long-lived
credential outlives the release that needed it.

1. On npmjs.com, open the **package** page → **Settings → Publish access →
   Trusted Publishers → Add a publisher**. Choose GitHub Actions and fill in:
   repository owner `transcodely`, repository `n8n-nodes-transcodely`, workflow
   `publish.yml`, environment blank.
2. In GitHub, delete the `NPM_TOKEN` repository secret. The workflow's token step
   is wrapped in `if [ -n "${NPM_TOKEN:-}" ]; then … fi`, so an absent secret is
   the normal path, not a failure.
3. On npmjs.com, revoke the granular token from step 1 of the previous section.
4. Every release after that publishes over OIDC with no secret in the repository.

## Cutting a release

```bash
git switch main && git pull

# 1. Prove the gate locally, exactly as CI runs it.
rm -rf node_modules && npm ci
npm run lint && npm run scan && npm test && npm run build

# 2. Bump the version. npm writes package.json and package-lock.json,
#    and --no-git-tag-version keeps tagging in step 4 where it is visible.
npm version --no-git-tag-version <patch|minor|major>

# 3. Describe the release at the top of CHANGELOG.md, then commit.
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: release $(node -p "require('./package.json').version")"

# 4. Tag and push. The v-prefixed tag is what the workflow listens for, and the
#    workflow refuses to publish if it disagrees with package.json.
git tag "v$(node -p "require('./package.json').version")"
git push origin main --follow-tags
```

Then watch the Publish workflow. It reinstalls from the lockfile, re-runs lint,
scan, tests and build, and publishes with an npm provenance attestation.

## After the release

Run the n8n verification scanner against the **published** package. This is the
full scan: it checks the npm provenance attestation first, then lints the source
the attestation points at. Neither leg can run before a release exists, which is
why CI runs only the static-analysis half (`npm run scan`).

```bash
npx @n8n/scan-community-package n8n-nodes-transcodely
```

Expect `✅ Provenance check passed` followed by a clean analysis. A provenance
failure means the publish did not come from `publish.yml`; do not submit for
verification until it passes.

Then submit the package for verification in the n8n Creator Portal. There is no
published review SLA.

### Answering the verification form

- **`n8n.strict` is `false` in `package.json`, deliberately.** That flag is
  `@n8n/node-cli`'s own guard that `eslint.config.mjs` has not been edited. This
  package edits it for one reason: `test/` is dev-only, never published
  (`files: ["dist"]`), and imports `node:test`/`node:assert` plus fixed fake
  `whsec_` signing vectors, which the n8n-Cloud rules `no-restricted-imports` and
  `no-hardcoded-secrets` flag. The config therefore disables exactly those two
  rules for `test/**/*.ts` and ignores build output. **Everything that ships keeps
  the full cloud ruleset**, `npm run lint` is clean, and `npm run scan` — which
  reads only `package.json`, `nodes/**` and `credentials/**`, and does not read
  `n8n.strict` at all — passes on both the source tree and the packed tarball.
- **Runtime dependencies: none.** `dependencies` is absent; `n8n-workflow` is a
  peer plus dev dependency, and `node:crypto` is the only other import.
- **Publishing** is GitHub Actions with an npm provenance statement, as required
  since 2026-05-01.
