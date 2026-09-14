import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	backoffDelayMs,
	nextPollDelayMs,
	normalizeEventSelection,
	validateBaseUrl,
	buildCreateJobRequest,
	buildCreateVideoFromUrlRequest,
	buildCreateWebhookEndpointRequest,
	buildListJobsRequest,
	buildOutputSpec,
	isTerminalJobStatus,
	normalizeBaseUrl,
	rpcUrl,
	WEBHOOK_EVENT_TYPES,
} from '../nodes/Transcodely/requests';

const ONE_OUTPUT = [{ type: 'hls', codec: 'h264', resolution: '1080p', quality: 'standard' }];

describe('normalizeBaseUrl and rpcUrl', () => {
	it('defaults to the public API host', () => {
		assert.equal(normalizeBaseUrl(undefined), 'https://api.transcodely.com');
		assert.equal(normalizeBaseUrl('  '), 'https://api.transcodely.com');
	});

	it('strips trailing slashes', () => {
		assert.equal(normalizeBaseUrl('https://api.example.com//'), 'https://api.example.com');
	});

	it('builds the Connect procedure URL', () => {
		assert.equal(
			rpcUrl('https://api.transcodely.com/', 'JobService', 'Create'),
			'https://api.transcodely.com/transcodely.v1.JobService/Create',
		);
	});
});

describe('validateBaseUrl', () => {
	it('accepts an empty value and falls back to the public host', () => {
		assert.deepEqual(validateBaseUrl(''), { ok: true, baseUrl: 'https://api.transcodely.com' });
		assert.deepEqual(validateBaseUrl(undefined), {
			ok: true,
			baseUrl: 'https://api.transcodely.com',
		});
	});

	it('accepts an https host and strips its trailing slash', () => {
		assert.deepEqual(validateBaseUrl('https://staging.transcodely.test/'), {
			ok: true,
			baseUrl: 'https://staging.transcodely.test',
		});
	});

	it('refuses plaintext http so the API key is never sent in the clear', () => {
		const result = validateBaseUrl('http://api.transcodely.com');
		assert.equal(result.ok, false);
		assert.match(result.ok === false ? result.reason : '', /https:\/\//);
	});

	it('refuses a base URL carrying a path', () => {
		const result = validateBaseUrl('https://evil.example.com/api.transcodely.com');
		assert.equal(result.ok, false);
		assert.match(result.ok === false ? result.reason : '', /no path/);
	});

	it('refuses a query string or fragment', () => {
		assert.equal(validateBaseUrl('https://api.transcodely.com?x=1').ok, false);
		assert.equal(validateBaseUrl('https://api.transcodely.com#x').ok, false);
	});

	it('refuses a value that is not a URL at all', () => {
		assert.equal(validateBaseUrl('https://').ok, false);
	});
});

describe('normalizeEventSelection', () => {
	it('collapses a selection containing the wildcard to the wildcard alone', () => {
		assert.deepEqual(normalizeEventSelection(['job.succeeded', '*', 'video.ready']), ['*']);
	});

	it('drops blanks and duplicates otherwise', () => {
		assert.deepEqual(normalizeEventSelection(['job.failed', ' ', 'job.failed', 'video.ready']), [
			'job.failed',
			'video.ready',
		]);
	});
});

describe('buildOutputSpec', () => {
	it('sends only the preset when one is given', () => {
		const spec = buildOutputSpec({ preset: 'pst_abc123', type: 'mp4', codec: 'h264' });
		assert.deepEqual(spec, { preset: 'pst_abc123' });
	});

	it('sends an inline variant when no preset is given', () => {
		const spec = buildOutputSpec({
			type: 'mp4',
			codec: 'h265',
			resolution: '720p',
			quality: 'premium',
			framerate: 60,
		});
		assert.deepEqual(spec, {
			type: 'mp4',
			video: [{ codec: 'h265', resolution: '720p', quality: 'premium', framerate: 60 }],
		});
	});

	it('omits a framerate of zero so the source rate is kept', () => {
		const spec = buildOutputSpec({ type: 'mp4', codec: 'h264', framerate: 0 });
		assert.equal((spec.video as Array<Record<string, unknown>>)[0].framerate, undefined);
	});

	it('carries a per-output path template alongside a preset', () => {
		const spec = buildOutputSpec({ preset: 'pst_abc123', pathTemplate: '{codec}-{resolution}' });
		assert.deepEqual(spec, { preset: 'pst_abc123', path_template: '{codec}-{resolution}' });
	});
});

describe('buildCreateJobRequest', () => {
	it('defaults to managed delivery from a URL input', () => {
		const body = buildCreateJobRequest({
			inputMode: 'url',
			inputUrl: 'https://example.com/source.mp4',
			deliveryMode: 'managed',
			outputs: ONE_OUTPUT,
		});
		assert.equal(body.input_url, 'https://example.com/source.mp4');
		assert.equal(body.managed, true);
		assert.equal(body.output_origin_id, undefined);
		assert.equal((body.outputs as unknown[]).length, 1);
	});

	it('sends origin plus path for an origin input and never an input URL', () => {
		const body = buildCreateJobRequest({
			inputMode: 'origin',
			inputOriginId: 'ori_a1b2c3d4e5f6',
			inputPath: 'uploads/source.mp4',
			inputUrl: 'https://leaked.example.com/should-not-be-sent.mp4',
			deliveryMode: 'managed',
			outputs: ONE_OUTPUT,
		});
		assert.equal(body.input_origin_id, 'ori_a1b2c3d4e5f6');
		assert.equal(body.input_path, 'uploads/source.mp4');
		assert.equal(body.input_url, undefined);
	});

	it('sends a hosted video input on its own', () => {
		const body = buildCreateJobRequest({
			inputMode: 'video',
			inputVideoId: 'vid_a1b2c3d4e5f6g7',
			deliveryMode: 'managed',
			outputs: ONE_OUTPUT,
		});
		assert.equal(body.input_video_id, 'vid_a1b2c3d4e5f6g7');
		assert.equal(body.input_origin_id, undefined);
		assert.equal(body.input_url, undefined);
	});

	it('sends an output origin and template instead of managed when own storage is chosen', () => {
		const body = buildCreateJobRequest({
			inputMode: 'url',
			inputUrl: 'https://example.com/source.mp4',
			deliveryMode: 'origin',
			outputOriginId: 'ori_out1234567',
			outputPathTemplate: 'videos/{job_id}',
			outputs: ONE_OUTPUT,
		});
		assert.equal(body.managed, undefined);
		assert.equal(body.output_origin_id, 'ori_out1234567');
		assert.equal(body.output_path_template, 'videos/{job_id}');
	});

	it('carries the optional job fields only when they are set', () => {
		const bare = buildCreateJobRequest({
			inputMode: 'url',
			inputUrl: 'https://example.com/source.mp4',
			deliveryMode: 'managed',
			outputs: ONE_OUTPUT,
			priority: '',
			idempotencyKey: '   ',
			metadata: [],
		});
		assert.equal(bare.priority, undefined);
		assert.equal(bare.idempotency_key, undefined);
		assert.equal(bare.metadata, undefined);
		assert.equal(bare.delayed_start, undefined);

		const full = buildCreateJobRequest({
			inputMode: 'url',
			inputUrl: 'https://example.com/source.mp4',
			deliveryMode: 'managed',
			outputs: ONE_OUTPUT,
			priority: 'premium',
			idempotencyKey: 'n8n-run-1',
			delayedStart: true,
			metadata: [
				{ name: 'tenant', value: 'acme' },
				{ name: '', value: 'dropped' },
			],
			appId: 'app_k1l2m3n4o5',
		});
		assert.equal(full.priority, 'premium');
		assert.equal(full.idempotency_key, 'n8n-run-1');
		assert.equal(full.delayed_start, true);
		assert.deepEqual(full.metadata, { tenant: 'acme' });
		assert.equal(full.app_id, 'app_k1l2m3n4o5');
	});

	it('uses snake_case keys throughout', () => {
		const body = buildCreateJobRequest({
			inputMode: 'origin',
			inputOriginId: 'ori_a1b2c3d4e5f6',
			inputPath: 'uploads/source.mp4',
			deliveryMode: 'origin',
			outputOriginId: 'ori_out1234567',
			outputPathTemplate: 'videos/{job_id}',
			outputs: ONE_OUTPUT,
			idempotencyKey: 'k',
		});
		for (const key of Object.keys(body)) {
			assert.match(key, /^[a-z0-9_]+$/, `key ${key} is not snake_case`);
		}
	});
});

describe('buildCreateVideoFromUrlRequest', () => {
	it('always sends the app and URL', () => {
		const body = buildCreateVideoFromUrlRequest({
			appId: 'app_k1l2m3n4o5',
			url: 'https://example.com/source.mp4',
		});
		assert.deepEqual(body, { app_id: 'app_k1l2m3n4o5', url: 'https://example.com/source.mp4' });
	});

	it('carries title, visibility, captions and tags when set', () => {
		const body = buildCreateVideoFromUrlRequest({
			appId: 'app_k1l2m3n4o5',
			url: 'https://example.com/source.mp4',
			title: 'Launch clip',
			visibility: 'unlisted',
			autoCaptions: true,
			hoverPreviews: true,
			tags: ['launch', ' ', 'marketing'],
		});
		assert.equal(body.title, 'Launch clip');
		assert.equal(body.visibility, 'unlisted');
		assert.equal(body.auto_captions, true);
		assert.equal(body.hover_previews, true);
		assert.deepEqual(body.tags, ['launch', 'marketing']);
	});

	it('omits visibility when the app default is chosen', () => {
		const body = buildCreateVideoFromUrlRequest({
			appId: 'app_k1l2m3n4o5',
			url: 'https://example.com/source.mp4',
			visibility: '',
			autoCaptions: false,
		});
		assert.equal(body.visibility, undefined);
		assert.equal(body.auto_captions, undefined);
	});
});

describe('buildListJobsRequest', () => {
	it('caps the page size at the API maximum', () => {
		const body = buildListJobsRequest({ limit: 500 });
		assert.deepEqual(body.pagination, { limit: 100 });
	});

	it('sends filters only when they are set', () => {
		assert.deepEqual(buildListJobsRequest({}), {});
		const body = buildListJobsRequest({
			limit: 10,
			cursor: 'abc',
			statuses: ['failed', 'canceled'],
			createdAfter: '2026-09-01T00:00:00Z',
		});
		assert.deepEqual(body.pagination, { limit: 10, cursor: 'abc' });
		assert.deepEqual(body.statuses, ['failed', 'canceled']);
		assert.equal(body.created_after, '2026-09-01T00:00:00Z');
		assert.equal(body.created_before, undefined);
	});
});

describe('buildCreateWebhookEndpointRequest', () => {
	it('collapses a wildcard selection before sending it', () => {
		const body = buildCreateWebhookEndpointRequest({
			appId: 'app_k1l2m3n4o5',
			url: 'https://n8n.example.com/webhook/abc',
			events: ['*', 'job.succeeded'],
		});
		assert.deepEqual(body.enabled_events, ['*']);
	});

	it('sends the app, URL and subscribed events', () => {
		const body = buildCreateWebhookEndpointRequest({
			appId: 'app_k1l2m3n4o5',
			url: 'https://n8n.example.com/webhook/abc',
			events: ['job.succeeded', 'job.failed'],
			description: 'n8n workflow Ingest',
		});
		assert.deepEqual(body, {
			app_id: 'app_k1l2m3n4o5',
			url: 'https://n8n.example.com/webhook/abc',
			enabled_events: ['job.succeeded', 'job.failed'],
			description: 'n8n workflow Ingest',
		});
	});

	it('truncates a description to the 500-character API limit', () => {
		const body = buildCreateWebhookEndpointRequest({
			appId: 'app_k1l2m3n4o5',
			url: 'https://n8n.example.com/webhook/abc',
			events: ['*'],
			description: 'x'.repeat(900),
		});
		assert.equal((body.description as string).length, 500);
	});
});

describe('catalog and polling helpers', () => {
	it('lists the 18 concrete webhook event types', () => {
		assert.equal(WEBHOOK_EVENT_TYPES.length, 18);
		assert.ok(!WEBHOOK_EVENT_TYPES.includes('*' as never));
		assert.ok(WEBHOOK_EVENT_TYPES.includes('video.source_scheduled_for_deletion'));
	});

	it('treats every end state, including awaiting_confirmation, as terminal', () => {
		for (const status of ['completed', 'failed', 'canceled', 'partial', 'awaiting_confirmation']) {
			assert.equal(isTerminalJobStatus(status), true, status);
		}
		for (const status of ['pending', 'probing', 'processing', 'leased', '']) {
			assert.equal(isTerminalJobStatus(status), false, status);
		}
	});

	it('shortens the last poll so it lands on the deadline', () => {
		assert.equal(nextPollDelayMs(0, 60000), 2000);
		assert.equal(nextPollDelayMs(0, 500), 500);
		assert.equal(nextPollDelayMs(9, 1200), 1200);
	});

	it('reports a timeout only when no time is left', () => {
		assert.equal(nextPollDelayMs(0, 0), null);
		assert.equal(nextPollDelayMs(0, -1), null);
		assert.equal(nextPollDelayMs(0, 1), 1);
	});

	it('backs off exponentially and then holds at the cap', () => {
		assert.equal(backoffDelayMs(0), 2000);
		assert.equal(backoffDelayMs(1), 3000);
		assert.equal(backoffDelayMs(2), 4500);
		assert.equal(backoffDelayMs(20), 30000);
		assert.equal(backoffDelayMs(-5), 2000);
	});
});
