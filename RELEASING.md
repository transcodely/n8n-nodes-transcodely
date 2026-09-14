# Releasing

Publishing is a maintainer action. The steps below happen locally; the tag push
is what triggers `.github/workflows/publish.yml`, and that workflow is the only
thing that ever runs `npm publish`.

## Before the first release

Set up npm publishing once, following the header of `.github/workflows/publish.yml`:
either add this repository and `publish.yml` as a Trusted Publisher on npmjs.com
(recommended — no secret lives in the repository), or store a granular npm access
token as the `NPM_TOKEN` repository secret.

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

Confirm the published package passes the scanner in full, provenance leg
included — the leg that cannot run before a release exists:

```bash
npx @n8n/scan-community-package n8n-nodes-transcodely
```

Then submit or re-submit the package for verification in the n8n Creator Portal.
