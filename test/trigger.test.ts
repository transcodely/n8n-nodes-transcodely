import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IDataObject, IHookFunctions, IWebhookFunctions } from 'n8n-workflow';

import { TranscodelyTrigger } from '../nodes/Transcodely/TranscodelyTrigger.node';
import { makeContext, procedureOf } from './helpers';
import type { MockContextOptions } from './helpers';

const trigger = new TranscodelyTrigger();
const methods = trigger.webhookMethods.default;

const SECRET = 'whsec_hq7Wm2hVQeWnpYQmKQwq0k0wq9tQ0bJf5wZ4Yb0Qm1c';
const WEBHOOK_URL = 'https://n8n.example.com/webhook/abc';

function hookContext(options: MockContextOptions) {
	return makeContext(options) as unknown as IHookFunctions & {
		calls: ReturnType<typeof makeContext>['calls'];
		staticData: IDataObject;
		logs: string[];
	};
}

describe('trigger create', () => {
	const params = { events: ['job.succeeded', 'job.failed'], options: {} };

	it('registers an endpoint and stores its ID and secret', async () => {
		const context = hookContext({
			params,
			credentials: { apiKey: 'ak_test_key', appId: 'app_k1l2m3n4o5' },
			responses: [
				{
					body: {
						endpoint: {
							id: 'whe_a1b2c3d4e5f6',
							secret: SECRET,
							url: WEBHOOK_URL,
							status: 'enabled',
						},
					},
				},
			],
		});

		const created = await methods.create.call(context);

		assert.equal(created, true);
		assert.equal(procedureOf(context.calls[0]), 'WebhookService/CreateWebhookEndpoint');
		assert.deepEqual(context.calls[0].options.body, {
			app_id: 'app_k1l2m3n4o5',
			url: WEBHOOK_URL,
			enabled_events: ['job.succeeded', 'job.failed'],
			description: 'n8n workflow Ingest',
		});
		assert.equal(context.staticData.webhookId, 'whe_a1b2c3d4e5f6');
		assert.equal(context.staticData.webhookSecret, SECRET);
	});

	it('refuses a non-HTTPS webhook URL and names the polling alternative', async () => {
		const context = hookContext({
			params,
			webhookUrl: 'http://n8n.example.com/webhook/abc',
			credentials: { apiKey: 'ak_test_key', appId: 'app_k1l2m3n4o5' },
		});
		await assert.rejects(methods.create.call(context), /public HTTPS URL/);
		assert.equal(context.calls.length, 0);
	});

	it('refuses a webhook URL on a private address', async () => {
		const context = hookContext({
			params,
			webhookUrl: 'https://192.168.1.10:5678/webhook/abc',
			credentials: { apiKey: 'ak_test_key', appId: 'app_k1l2m3n4o5' },
		});
		await assert.rejects(methods.create.call(context), /private address/);
		assert.equal(context.calls.length, 0);
	});

	it('refuses to arm the trigger when no signing secret comes back', async () => {
		const context = hookContext({
			params,
			credentials: { apiKey: 'ak_test_key', appId: 'app_k1l2m3n4o5' },
			responses: [{ body: { endpoint: { id: 'whe_a1b2c3d4e5f6', url: WEBHOOK_URL } } }],
		});
		await assert.rejects(methods.create.call(context), /did not return a usable webhook endpoint/);
		assert.equal(context.staticData.webhookId, undefined);
	});
});

describe('trigger checkExists', () => {
	it('reports false when nothing is stored yet', async () => {
		const context = hookContext({ staticData: {} });
		assert.equal(await methods.checkExists.call(context), false);
		assert.equal(context.calls.length, 0);
	});

	it('reports true when the stored endpoint still points at this workflow', async () => {
		const context = hookContext({
			staticData: { webhookId: 'whe_a1b2c3d4e5f6', webhookSecret: SECRET },
			responses: [
				{ body: { endpoint: { id: 'whe_a1b2c3d4e5f6', url: WEBHOOK_URL, status: 'enabled' } } },
			],
		});
		assert.equal(await methods.checkExists.call(context), true);
		assert.equal(procedureOf(context.calls[0]), 'WebhookService/RetrieveWebhookEndpoint');
	});

	it('reports false when the stored endpoint now points somewhere else', async () => {
		const context = hookContext({
			staticData: { webhookId: 'whe_a1b2c3d4e5f6', webhookSecret: SECRET },
			responses: [
				{
					body: {
						endpoint: {
							id: 'whe_a1b2c3d4e5f6',
							url: 'https://elsewhere.example.com/hook',
							status: 'enabled',
						},
					},
				},
			],
		});
		assert.equal(await methods.checkExists.call(context), false);
	});

	it('reports false and logs when the endpoint is gone', async () => {
		const context = hookContext({
			staticData: { webhookId: 'whe_a1b2c3d4e5f6', webhookSecret: SECRET },
			responses: [
				{ statusCode: 404, body: { code: 'not_found', message: 'webhook endpoint not found' } },
			],
		});
		assert.equal(await methods.checkExists.call(context), false);
		assert.ok(context.logs.some((line) => line.startsWith('debug:')));
	});
});

describe('trigger delete', () => {
	it('deletes the endpoint and clears the stored secret', async () => {
		const context = hookContext({
			staticData: { webhookId: 'whe_a1b2c3d4e5f6', webhookSecret: SECRET },
			responses: [{ body: {} }],
		});
		assert.equal(await methods.delete.call(context), true);
		assert.equal(procedureOf(context.calls[0]), 'WebhookService/DeleteWebhookEndpoint');
		assert.equal(context.staticData.webhookId, undefined);
		assert.equal(context.staticData.webhookSecret, undefined);
	});

	it('clears local state and warns when the delete is refused', async () => {
		const context = hookContext({
			staticData: { webhookId: 'whe_a1b2c3d4e5f6', webhookSecret: SECRET },
			responses: [
				{ statusCode: 403, body: { code: 'permission_denied', message: 'not your endpoint' } },
			],
		});
		assert.equal(await methods.delete.call(context), false);
		assert.ok(context.logs.some((line) => line.startsWith('warn:')));
		assert.equal(context.staticData.webhookSecret, undefined);
	});

	it('is a no-op when nothing was registered', async () => {
		const context = hookContext({ staticData: {} });
		assert.equal(await methods.delete.call(context), true);
		assert.equal(context.calls.length, 0);
	});
});

describe('trigger webhook handler', () => {
	const event = { id: 'evt_a1b2c3d4e5f6g7h8', object: 'event', type: 'job.succeeded' };
	const rawBody = Buffer.from(JSON.stringify(event), 'utf8');

	function signedHeaders(timestamp: number, secret = SECRET) {
		const signature = createHmac('sha256', secret)
			.update(`${timestamp}.${rawBody.toString('utf8')}`)
			.digest('hex');
		return { 'transcodely-signature': `t=${timestamp},v1=${signature}`, 'webhook-id': event.id };
	}

	it('passes a correctly signed delivery into the workflow', async () => {
		const now = Math.floor(Date.now() / 1000);
		const context = makeContext({
			staticData: { webhookId: 'whe_a1b2c3d4e5f6', webhookSecret: SECRET },
			headers: signedHeaders(now),
			body: event,
			rawBody,
			params: { options: {} },
		});

		const result = await trigger.webhook.call(context as unknown as IWebhookFunctions);

		assert.deepEqual(result.workflowData?.[0][0].json, event);
		assert.equal(context.responseStatus, null);
	});

	it('answers 401 when the signature does not match', async () => {
		const now = Math.floor(Date.now() / 1000);
		const context = makeContext({
			staticData: { webhookId: 'whe_a1b2c3d4e5f6', webhookSecret: SECRET },
			headers: signedHeaders(now, 'whsec_an_entirely_different_secret_value'),
			body: event,
			rawBody,
			params: { options: {} },
		});

		const result = await trigger.webhook.call(context as unknown as IWebhookFunctions);

		assert.equal(result.noWebhookResponse, true);
		assert.equal(result.workflowData, undefined);
		assert.equal(context.responseStatus, 401);
	});

	it('answers 401 for a replayed delivery outside the window', async () => {
		const stale = Math.floor(Date.now() / 1000) - 3600;
		const context = makeContext({
			staticData: { webhookId: 'whe_a1b2c3d4e5f6', webhookSecret: SECRET },
			headers: signedHeaders(stale),
			body: event,
			rawBody,
			params: { options: {} },
		});

		const result = await trigger.webhook.call(context as unknown as IWebhookFunctions);

		assert.equal(result.noWebhookResponse, true);
		assert.equal(context.responseStatus, 401);
	});

	it('answers 401 when no secret is stored for the workflow', async () => {
		const now = Math.floor(Date.now() / 1000);
		const context = makeContext({
			staticData: {},
			headers: signedHeaders(now),
			body: event,
			rawBody,
			params: { options: {} },
		});

		const result = await trigger.webhook.call(context as unknown as IWebhookFunctions);

		assert.equal(result.noWebhookResponse, true);
		assert.equal(context.responseStatus, 401);
	});

	it('verifies against the re-serialized body when no raw body is available', async () => {
		const now = Math.floor(Date.now() / 1000);
		const context = makeContext({
			staticData: { webhookId: 'whe_a1b2c3d4e5f6', webhookSecret: SECRET },
			headers: signedHeaders(now),
			body: event,
			params: { options: {} },
		});

		const result = await trigger.webhook.call(context as unknown as IWebhookFunctions);

		assert.deepEqual(result.workflowData?.[0][0].json, event);
	});
});
