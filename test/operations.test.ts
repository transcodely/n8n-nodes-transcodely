import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { Transcodely } from '../nodes/Transcodely/Transcodely.node';
import { makeContext, procedureOf } from './helpers';
import type { MockContext, MockContextOptions } from './helpers';

const node = new Transcodely();

async function run(options: MockContextOptions): Promise<{
	context: MockContext;
	items: INodeExecutionData[];
}> {
	const context = makeContext(options);
	const output = await node.execute.call(context as unknown as IExecuteFunctions);
	return { context, items: output[0] };
}

function bodyOf(context: MockContext, index = 0): IDataObject {
	return context.calls[index].options.body as IDataObject;
}

describe('Job: Create', () => {
	const params = {
		resource: 'job',
		operation: 'create',
		inputMode: 'url',
		inputUrl: 'https://example.com/source.mp4',
		deliveryMode: 'managed',
		outputs: {
			output: [
				{ preset: '', type: 'hls', codec: 'h264', resolution: '1080p', quality: 'standard' },
			],
		},
		options: {},
	};

	it('posts to JobService/Create and returns the job', async () => {
		const { context, items } = await run({
			params,
			responses: [
				{
					body: {
						job: { id: 'job_a1b2c3d4e5f6', status: 'pending' },
						video_id: 'vid_a1b2c3d4e5f6g7',
					},
				},
			],
		});

		assert.equal(context.calls.length, 1);
		assert.equal(procedureOf(context.calls[0]), 'JobService/Create');
		assert.equal(context.calls[0].credentialsType, 'transcodelyApi');
		assert.equal(context.calls[0].options.method, 'POST');
		assert.deepEqual(bodyOf(context), {
			input_url: 'https://example.com/source.mp4',
			managed: true,
			outputs: [
				{ type: 'hls', video: [{ codec: 'h264', resolution: '1080p', quality: 'standard' }] },
			],
		});
		assert.equal(items[0].json.id, 'job_a1b2c3d4e5f6');
		assert.equal(items[0].json.video_id, 'vid_a1b2c3d4e5f6g7');
		assert.deepEqual(items[0].pairedItem, { item: 0 });
	});

	it('pins the calendar API version on every request', async () => {
		const { context } = await run({
			params,
			responses: [{ body: { job: { id: 'job_a1b2c3d4e5f6' } } }],
		});
		const headers = (context.calls[0].options.headers ?? {}) as Record<string, unknown>;
		assert.equal(headers['Transcodely-Version'], '2026-05-03');
		assert.equal(headers['Content-Type'], 'application/json');
	});

	it('never sets an Authorization header itself', async () => {
		const { context } = await run({
			params,
			responses: [{ body: { job: { id: 'job_a1b2c3d4e5f6' } } }],
		});
		const headers = (context.calls[0].options.headers ?? {}) as Record<string, unknown>;
		for (const key of Object.keys(headers)) {
			assert.notEqual(key.toLowerCase(), 'authorization');
		}
	});

	it('honors a custom base URL from the credential', async () => {
		const { context } = await run({
			params,
			credentials: { apiKey: 'ak_test_key', baseUrl: 'https://staging.transcodely.test/' },
			responses: [{ body: { job: { id: 'job_a1b2c3d4e5f6' } } }],
		});
		assert.equal(
			context.calls[0].options.url,
			'https://staging.transcodely.test/transcodely.v1.JobService/Create',
		);
	});

	it('rejects a create with no outputs before calling the API', async () => {
		await assert.rejects(
			run({ params: { ...params, outputs: { output: [] } }, responses: [] }),
			/At least one output is required/,
		);
	});

	it('stamps the API code and HTTP status onto the error context', async () => {
		await assert.rejects(
			run({
				params,
				responses: [
					{
						statusCode: 404,
						headers: { 'error-code': 'origin_not_found' },
						body: { code: 'not_found', message: 'origin not found' },
					},
				],
			}),
			(error: Error & { context?: Record<string, unknown> }) => {
				assert.equal(error.context?.transcodelyErrorCode, 'origin_not_found');
				assert.equal(error.context?.transcodelyStatusCode, 404);
				return true;
			},
		);
	});

	it('surfaces the API error code and message, not the raw body', async () => {
		await assert.rejects(
			run({
				params,
				responses: [
					{
						statusCode: 429,
						headers: { 'error-code': 'queue_limit_exceeded' },
						body: { code: 'resource_exhausted', message: 'app already has 50 pending jobs' },
					},
				],
			}),
			(error: Error) => {
				assert.match(error.message, /queue_limit_exceeded/);
				assert.match(error.message, /50 pending jobs/);
				return true;
			},
		);
	});

	it('routes an API failure into the item when continueOnFail is on', async () => {
		const { items } = await run({
			params,
			continueOnFail: true,
			responses: [{ statusCode: 404, body: { code: 'not_found', message: 'origin not found' } }],
		});
		assert.equal(items.length, 1);
		assert.match(String(items[0].json.error), /origin not found/);
	});
});

describe('Credential base URL', () => {
	const params = {
		resource: 'job',
		operation: 'get',
		jobId: 'job_a1b2c3d4e5f6',
	};

	it('refuses a plaintext base URL before any request is made', async () => {
		const context = makeContext({
			params,
			credentials: { apiKey: 'ak_test_key', baseUrl: 'http://api.transcodely.com' },
			responses: [],
		});
		await assert.rejects(
			node.execute.call(context as unknown as IExecuteFunctions),
			/Base URL on the Transcodely credential/,
		);
		assert.equal(context.calls.length, 0);
	});

	it('refuses a base URL carrying a path before any request is made', async () => {
		const context = makeContext({
			params,
			credentials: { apiKey: 'ak_test_key', baseUrl: 'https://evil.example.com/api' },
			responses: [],
		});
		await assert.rejects(
			node.execute.call(context as unknown as IExecuteFunctions),
			(error: Error & { description?: string }) => {
				assert.match(error.message, /Base URL on the Transcodely credential/);
				assert.match(error.description ?? '', /no path/);
				return true;
			},
		);
		assert.equal(context.calls.length, 0);
	});
});

describe('Secret handling', () => {
	it('keeps the API key out of every request the node builds and every error it raises', async () => {
		const apiKey = 'ak_a1b2c3d4e5f6g7h8i9j0k1l2';
		const context = makeContext({
			params: { resource: 'job', operation: 'get', jobId: 'job_a1b2c3d4e5f6' },
			credentials: { apiKey },
			responses: [
				{ statusCode: 401, body: { code: 'unauthenticated', message: 'api key rejected' } },
			],
		});

		await assert.rejects(
			node.execute.call(context as unknown as IExecuteFunctions),
			(error: Error) => {
				// The key reaches the wire only through the credential's own
				// authenticate block, which httpRequestWithAuthentication applies
				// after the node hands the options over.
				assert.ok(!JSON.stringify(context.calls).includes(apiKey));
				assert.ok(!JSON.stringify(error.message).includes(apiKey));
				assert.ok(
					!JSON.stringify((error as { description?: string }).description ?? '').includes(apiKey),
				);
				assert.ok(!context.logs.join('\n').includes(apiKey));
				return true;
			},
		);
	});
});

describe('Job: Get', () => {
	it('posts the job ID to JobService/Get', async () => {
		const { context, items } = await run({
			params: { resource: 'job', operation: 'get', jobId: 'job_a1b2c3d4e5f6' },
			responses: [{ body: { job: { id: 'job_a1b2c3d4e5f6', status: 'completed' } } }],
		});
		assert.equal(procedureOf(context.calls[0]), 'JobService/Get');
		assert.deepEqual(bodyOf(context), { id: 'job_a1b2c3d4e5f6' });
		assert.equal(items[0].json.status, 'completed');
	});
});

describe('Job: Get Many', () => {
	it('returns one item per job and stops at the limit', async () => {
		const { context, items } = await run({
			params: { resource: 'job', operation: 'getAll', returnAll: false, limit: 2, filters: {} },
			responses: [
				{
					body: {
						jobs: [{ id: 'job_1' }, { id: 'job_2' }, { id: 'job_3' }],
						pagination: { next_cursor: 'next' },
					},
				},
			],
		});
		assert.equal(context.calls.length, 1);
		assert.equal(items.length, 2);
		assert.deepEqual(
			items.map((item) => item.json.id),
			['job_1', 'job_2'],
		);
	});

	it('follows the cursor when Return All is on', async () => {
		const { context, items } = await run({
			params: { resource: 'job', operation: 'getAll', returnAll: true, filters: {} },
			responses: [
				{ body: { jobs: [{ id: 'job_1' }], pagination: { next_cursor: 'c2' } } },
				{ body: { jobs: [{ id: 'job_2' }], pagination: { next_cursor: '' } } },
			],
		});
		assert.equal(context.calls.length, 2);
		assert.equal((bodyOf(context, 1).pagination as IDataObject).cursor, 'c2');
		assert.equal(items.length, 2);
	});

	it('passes status and date filters through', async () => {
		const { context } = await run({
			params: {
				resource: 'job',
				operation: 'getAll',
				returnAll: false,
				limit: 5,
				filters: { statuses: ['failed'], createdAfter: '2026-09-01T00:00:00Z' },
			},
			responses: [{ body: { jobs: [], pagination: {} } }],
		});
		assert.deepEqual(bodyOf(context).statuses, ['failed']);
		assert.equal(bodyOf(context).created_after, '2026-09-01T00:00:00Z');
	});
});

describe('Job: Wait for Completion', () => {
	it('returns immediately when the job is already completed', async () => {
		const { context, items } = await run({
			params: {
				resource: 'job',
				operation: 'wait',
				jobId: 'job_a1b2c3d4e5f6',
				maxWaitSeconds: 60,
				failOnJobFailure: true,
			},
			responses: [{ body: { job: { id: 'job_a1b2c3d4e5f6', status: 'completed' } } }],
		});
		assert.equal(context.calls.length, 1);
		assert.equal(items[0].json.status, 'completed');
	});

	it('polls until the job leaves a running status', async () => {
		const { context, items } = await run({
			params: {
				resource: 'job',
				operation: 'wait',
				jobId: 'job_a1b2c3d4e5f6',
				maxWaitSeconds: 60,
				failOnJobFailure: true,
			},
			responses: [
				{ body: { job: { id: 'job_a1b2c3d4e5f6', status: 'processing' } } },
				{ body: { job: { id: 'job_a1b2c3d4e5f6', status: 'completed' } } },
			],
		});
		assert.equal(context.calls.length, 2);
		assert.equal(items[0].json.status, 'completed');
	});

	it('raises the job error when it ends failed', async () => {
		await assert.rejects(
			run({
				params: {
					resource: 'job',
					operation: 'wait',
					jobId: 'job_a1b2c3d4e5f6',
					maxWaitSeconds: 60,
					failOnJobFailure: true,
				},
				responses: [
					{
						body: {
							job: {
								id: 'job_a1b2c3d4e5f6',
								status: 'failed',
								error_message: 'input has no video stream',
								error_code: 'input_no_video_stream',
							},
						},
					},
				],
			}),
			/input has no video stream/,
		);
	});

	it('returns the failed job instead of raising when the toggle is off', async () => {
		const { items } = await run({
			params: {
				resource: 'job',
				operation: 'wait',
				jobId: 'job_a1b2c3d4e5f6',
				maxWaitSeconds: 60,
				failOnJobFailure: false,
			},
			responses: [{ body: { job: { id: 'job_a1b2c3d4e5f6', status: 'failed' } } }],
		});
		assert.equal(items[0].json.status, 'failed');
	});

	it('flags a job parked in awaiting_confirmation rather than polling forever', async () => {
		const { context, items } = await run({
			params: {
				resource: 'job',
				operation: 'wait',
				jobId: 'job_a1b2c3d4e5f6',
				maxWaitSeconds: 60,
				failOnJobFailure: true,
			},
			responses: [{ body: { job: { id: 'job_a1b2c3d4e5f6', status: 'awaiting_confirmation' } } }],
		});
		assert.equal(context.calls.length, 1);
		assert.match(String(items[0].json.wait_note), /awaiting confirmation/);
	});

	it('gives up once the max wait is exhausted', async () => {
		await assert.rejects(
			run({
				params: {
					resource: 'job',
					operation: 'wait',
					jobId: 'job_a1b2c3d4e5f6',
					maxWaitSeconds: 0,
					failOnJobFailure: true,
				},
				responses: [{ body: { job: { id: 'job_a1b2c3d4e5f6', status: 'processing' } } }],
			}),
			/did not finish within 0 seconds/,
		);
	});
});

describe('Video: Create From URL', () => {
	const params = {
		resource: 'video',
		operation: 'createFromUrl',
		url: 'https://example.com/source.mp4',
		options: { title: 'Launch clip', visibility: 'unlisted', autoCaptions: true },
	};

	it('uses the credential App ID without an extra lookup', async () => {
		const { context, items } = await run({
			params,
			credentials: { apiKey: 'ak_test_key', appId: 'app_k1l2m3n4o5' },
			responses: [{ body: { video: { id: 'vid_a1b2c3d4e5f6g7', status: 'processing' } } }],
		});
		assert.equal(context.calls.length, 1);
		assert.equal(procedureOf(context.calls[0]), 'VideoService/CreateFromUrl');
		assert.deepEqual(bodyOf(context), {
			app_id: 'app_k1l2m3n4o5',
			url: 'https://example.com/source.mp4',
			title: 'Launch clip',
			visibility: 'unlisted',
			auto_captions: true,
		});
		assert.equal(items[0].json.id, 'vid_a1b2c3d4e5f6g7');
	});

	it('discovers the app from the latest job when the credential omits it', async () => {
		const { context } = await run({
			params,
			responses: [
				{ body: { jobs: [{ id: 'job_a1b2c3d4e5f6', app_id: 'app_discovered' }], pagination: {} } },
				{ body: { video: { id: 'vid_a1b2c3d4e5f6g7' } } },
			],
		});
		assert.equal(procedureOf(context.calls[0]), 'JobService/List');
		assert.equal(procedureOf(context.calls[1]), 'VideoService/CreateFromUrl');
		assert.equal(bodyOf(context, 1).app_id, 'app_discovered');
	});

	it('discovers the app once for a whole batch of items', async () => {
		const { context } = await run({
			params,
			items: [{ json: {} }, { json: {} }, { json: {} }],
			responses: [
				{ body: { jobs: [{ id: 'job_a1b2c3d4e5f6', app_id: 'app_discovered' }], pagination: {} } },
				{ body: { video: { id: 'vid_1' } } },
				{ body: { video: { id: 'vid_2' } } },
				{ body: { video: { id: 'vid_3' } } },
			],
		});
		const lookups = context.calls.filter((call) => procedureOf(call) === 'JobService/List');
		assert.equal(lookups.length, 1);
		assert.equal(context.calls.length, 4);
		for (const call of context.calls.slice(1)) {
			assert.equal((call.options.body as IDataObject).app_id, 'app_discovered');
		}
	});

	it('asks the user for an App ID when nothing can be discovered', async () => {
		await assert.rejects(
			run({ params, responses: [{ body: { jobs: [], pagination: {} } }] }),
			/Could not determine which app to use/,
		);
	});
});

describe('Video: Get', () => {
	it('posts the video ID to VideoService/Get', async () => {
		const { context, items } = await run({
			params: { resource: 'video', operation: 'get', videoId: 'vid_a1b2c3d4e5f6g7' },
			responses: [{ body: { video: { id: 'vid_a1b2c3d4e5f6g7', status: 'ready' } } }],
		});
		assert.equal(procedureOf(context.calls[0]), 'VideoService/Get');
		assert.deepEqual(bodyOf(context), { id: 'vid_a1b2c3d4e5f6g7' });
		assert.equal(items[0].json.status, 'ready');
	});
});

describe('Unsupported combinations', () => {
	it('refuses an operation that does not exist on the resource', async () => {
		await assert.rejects(
			run({ params: { resource: 'video', operation: 'wait' }, responses: [] }),
			/not supported for resource/,
		);
	});
});
