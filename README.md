# n8n-nodes-transcodely

An [n8n](https://n8n.io) community node for [Transcodely](https://transcodely.com) — video transcoding, adaptive streaming and hosted playback.

Submit a transcode from a URL or your own bucket, ingest a hosted video in one request, wait for a job to finish, and start workflows from signed Transcodely webhooks. The package has **no runtime dependencies**: it speaks plain JSON over HTTPS through n8n's own HTTP helper and verifies webhook signatures with Node's built-in `crypto`.

- [Installation](#installation)
- [Credentials](#credentials)
- [Operations](#operations)
- [Trigger](#trigger)
- [Polling instead of webhooks](#polling-instead-of-webhooks)
- [Error handling](#error-handling)
- [Screenshots](#screenshots)
- [Compatibility](#compatibility)
- [Development](#development)
- [Verification checklist](#verification-checklist)

## Installation

In n8n, go to **Settings → Community nodes → Install** and enter:

```
n8n-nodes-transcodely
```

Self-hosted instances can also install it from the command line:

```bash
npm install n8n-nodes-transcodely
```

Follow the [n8n community node installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) if you need the full walkthrough.

## Credentials

Create a **Transcodely API** credential.

| Field | Required | Notes |
|---|---|---|
| API Key | yes | An app-scoped key from the Transcodely dashboard, beginning `ak_`. Sent as `Authorization: Bearer …`. |
| Base URL | no | Defaults to `https://api.transcodely.com`. Must be an `https://` host with no path — the API key is sent to it on every request, so a plaintext or path-carrying value is refused before anything is sent. |
| App ID | no | Looks like `app_xxxxxxxxxx`. Needed by **Create Video From URL** and by the trigger; see below. |

The credential test calls `JobService/List` with a page size of one, so saving it proves the key works without creating anything.

**About the App ID.** Most calls derive the app from the API key itself. Two of them — creating a hosted video from a URL, and registering a webhook endpoint — still require the app to be named explicitly. When the field is empty the node reads the app from your most recent job; if the account has no jobs yet, that lookup has nothing to read and the node asks you to fill the field in. Filling it in always skips the extra lookup.

## Operations

### Job → Create

Submits a transcoding job.

- **Input Source** — a URL (`gs://`, `s3://` or `https://`), an origin plus a path inside it, or an existing hosted video.
- **Delivery** — *Transcodely Managed Storage* (the default; outputs are hosted and delivered over the Transcodely CDN, and hosting is provisioned on the first job that asks for it) or *My Own Storage*, which takes an output origin ID and an optional job-level path template.
- **Outputs** — one row per rendition, up to ten. A row either names a preset (ID or slug) or sets container, codec, resolution, quality tier and framerate inline. A per-output path template composes onto the job-level one.
- **Options** — priority, idempotency key, delayed start and metadata pairs.

Returns the created job. When the job writes to managed storage the response also carries `video_id`.

This node is available to AI Agent nodes as a tool, which means an agent can submit paid encodes without asking first. Set a [monthly spend limit](https://transcodely.com/docs) on the app whose key the agent holds before wiring it up.

### Job → Get

Reads one job by `job_…` ID.

### Job → Get Many

Lists jobs in the app, newest first. Supports **Return All** (it follows the cursor) or a **Limit**, plus status and creation-date filters. Each job is returned as its own item.

### Job → Wait for Completion

Polls `JobService/Get` with exponential backoff — 2 s, then 3 s, 4.5 s and so on, capped at 30 s — until the job reaches an end state, then returns it.

- **Max Wait (Seconds)** bounds the total wait; exceeding it raises an error naming the last status seen.
- **Fail on Job Failure** (on by default) raises the job's own error message and code when it ends `failed`, `canceled` or `partial`. Turn it off to route the job object onward and branch on `status` yourself.
- A job created with **Delayed Start** parks in `awaiting_confirmation` and cannot progress without a confirm call, so the node stops there and adds a `wait_note` rather than polling until the timeout.

Use the trigger instead of this operation whenever your n8n instance can receive webhooks — polling a long encode burns executions.

### Video → Create From URL

Ingests a publicly reachable `http(s)` URL as a hosted video in a single request: title, description, tags, visibility (`public`, `unlisted`, `private`, or the app default), an optional preset, AI captions and hover previews. Transcodely downloads the URL at transcode time; private and internal addresses are refused.

Returns the video in `processing`. Playback and embed URLs appear once it reaches `ready` — subscribe to `video.ready` with the trigger.

### Video → Get

Reads one video by `vid_…` ID.

## Trigger

**Transcodely Trigger** starts a workflow when Transcodely sends an event.

On activation it registers a webhook endpoint on your app pointing at this workflow's production webhook URL and stores the endpoint ID and signing secret in the workflow's static data. On deactivation it deletes the endpoint again.

Every delivery is verified before the workflow runs:

- the `Transcodely-Signature` header is parsed into its timestamp and one or more `v1=` HMAC-SHA-256 signatures,
- each signature is recomputed over `<timestamp>.<body>` with the stored secret, using Node's `crypto`, and compared in constant time,
- deliveries outside the replay window (300 s by default, configurable) are rejected,
- anything that fails answers `401` and never starts the workflow.

Both signatures sent during Transcodely's 24-hour secret-rotation overlap are accepted, so a rotation does not drop events.

**Deliveries are at-least-once, and the node does not deduplicate them.** Transcodely can resend an event after a crash or a manual replay, and a delivery captured inside the replay window verifies again. Every delivery carries a unique `webhook-id` header and the same id as `id` in the body, so make the workflow idempotent on it — key whatever you write downstream on that id rather than assuming one event runs the workflow once. The node deliberately keeps no record of seen ids: deduplicating inside a trigger would mean per-workflow state that grows without bound and still misses a second n8n instance.

Activating a workflow whose stored endpoint is missing re-registers it, so deleting the endpoint in the Transcodely dashboard is recoverable. If a stored endpoint is left behind from an earlier activation the node deletes it before registering a replacement; when that delete is refused it logs a warning naming the endpoint and registers anyway, so an orphan can survive and should be removed in the dashboard.

Subscribe to any of the 18 event types, or to `*` for all of them: `job.created`, `job.succeeded`, `job.failed`, `job.canceled`, `job.progress`, `output.created`, `output.ready`, `output.failed`, `output.progress`, `video.uploaded`, `video.ready`, `video.failed`, `video.deleted`, `video.source_scheduled_for_deletion`, `app.created`, `app.updated`, `app.spend_limit_warning`, `app.spend_limit_exceeded`.

### Public HTTPS is required

Transcodely delivers only to public HTTPS URLs. Loopback, private-range and link-local addresses are rejected when the endpoint is created and again at delivery time. A self-hosted n8n on a LAN, or one reachable only over plain HTTP, cannot receive events, and the trigger says so instead of registering an endpoint that would never fire.

To use the trigger on a self-hosted instance, put n8n behind a public HTTPS hostname and set `WEBHOOK_URL` to it.

## Polling instead of webhooks

If a public URL is out of reach, poll instead:

1. **Schedule Trigger** every few minutes.
2. **Transcodely → Job → Get Many** with a status filter of `processing` and `pending`, or **Job → Wait for Completion** with the job ID carried from an earlier step.
3. Branch on `status` and continue.

Polling costs one execution per interval and reports a completed job up to one interval late, so prefer the trigger where the network allows it.

## Error handling

A refused request surfaces the API's own machine-readable code and the message the API returned with it, in the form:

```
Transcodely API error [<code>]: <message from the API>
```

Codes worth branching on: `limit_exceeded` (the app's monthly spend cap — retrying does not help), `queue_limit_exceeded` (the queue is full — back off and retry), `intake_paused` (Transcodely paused intake platform-wide — retry with backoff), `billing_past_due` and `outstanding_balance_exceeded` (clear only when the account is paid). Raw response bodies are never passed through to the workflow.

Enabling **Continue On Fail** puts the message on the item as `error` and lets the workflow proceed.

## Screenshots

This README carries no screenshots yet. They are captured from a real n8n instance and added by the maintainer before the n8n verification submission; `docs/images/README.md` lists the five shots and what each should show.

## Compatibility

| | |
|---|---|
| n8n | 1.x, nodes API version 1 |
| Node.js | ≥ 20.15 |
| Transcodely API | calendar version `2026-05-03`, pinned by the node on every request |
| Runtime dependencies | none |

## Development

```bash
npm install
npm run lint     # n8n community-node ESLint rules
npm run scan     # the verification scanner's static-analysis leg
npm test         # unit tests over the request builders, error mapper and signature verifier
npm run build    # tsc + icon copy into dist/
npm run dev      # run the node against a local n8n
```

Releases are cut by hand and published by CI — see [RELEASING.md](RELEASING.md).

Tests use Node's built-in test runner and never reach the network: every HTTP call is answered by a recorded mock, and the signature vectors are computed with `crypto` inside the test.

## Verification checklist

n8n verification makes the node installable on n8n Cloud. These steps are owned by a maintainer with npm and Creator Portal access:

- [ ] npm account or organization able to publish `n8n-nodes-transcodely`. The name was unclaimed on 2026-09-14; re-check with `npm view n8n-nodes-transcodely version` before the release.
- [ ] Configure publishing. The first release must use an `NPM_TOKEN` secret, because npm's Trusted Publishing is configured on a package page that does not exist until the package does; switch to Trusted Publishing and delete the secret straight after. Exact ordering in [RELEASING.md](RELEASING.md). Publishing through GitHub Actions with a provenance statement has been mandatory since 2026-05-01.
- [ ] Capture the five screenshots listed in `docs/images/README.md` and add them to the README.
- [ ] Cut the first release by following [RELEASING.md](RELEASING.md). Pushing the `v…` tag is what publishes.
- [ ] After the release lands, confirm the published package passes the full scan, provenance leg included: `npx @n8n/scan-community-package n8n-nodes-transcodely`.
- [ ] Submit the package for verification in the n8n Creator Portal. There is no published review SLA.

## License

[MIT](LICENSE.md)
