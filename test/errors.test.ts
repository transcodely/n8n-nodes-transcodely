import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { INode } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { asNodeError, describeApiError, formatApiError } from '../nodes/Transcodely/errors';

const NODE = {
	id: 'n1',
	name: 'Transcodely',
	type: 'n8n-nodes-transcodely.transcodely',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
} as INode;

describe('describeApiError', () => {
	it('prefers the error-code header over the Connect code in the body', () => {
		const info = describeApiError(
			400,
			{ 'error-code': 'queue_limit_exceeded' },
			{ code: 'resource_exhausted', message: 'app already has 50 pending jobs' },
		);
		assert.equal(info.code, 'queue_limit_exceeded');
		assert.equal(info.message, 'app already has 50 pending jobs');
		assert.equal(info.statusCode, 400);
	});

	it('falls back to the Connect code when no header is present', () => {
		const info = describeApiError(404, {}, { code: 'not_found', message: 'job not found' });
		assert.equal(info.code, 'not_found');
		assert.equal(info.message, 'job not found');
	});

	it('falls back to a status-derived code when the body is empty', () => {
		const info = describeApiError(401, undefined, undefined);
		assert.equal(info.code, 'unauthenticated');
		assert.match(info.message, /API key/);
	});

	it('appends field violations from the Stripe-style detail payload', () => {
		const info = describeApiError(
			400,
			{ 'error-code': 'invalid_argument' },
			{
				code: 'invalid_argument',
				message: 'Validation failed',
				details: [
					{
						field_violations: [
							{
								field: 'outputs[0].video[0].crf',
								description: '[parameter_out_of_range] CRF must be between 15 and 35',
							},
						],
					},
				],
			},
		);
		assert.match(info.message, /outputs\[0\]\.video\[0\]\.crf/);
		assert.match(info.message, /parameter_out_of_range/);
	});

	it('never echoes an unexpected raw body back to the workflow', () => {
		const info = describeApiError(500, {}, '<html>gateway exploded, secret=abc123</html>');
		assert.ok(!info.message.includes('secret=abc123'));
		assert.equal(info.code, 'internal');
	});

	it('formats a single-line summary carrying the code', () => {
		const line = formatApiError({
			code: 'limit_exceeded',
			message: 'spend limit reached',
			statusCode: 429,
		});
		assert.equal(line, 'Transcodely API error [limit_exceeded]: spend limit reached');
	});
});

describe('asNodeError', () => {
	it('passes an existing NodeApiError through untouched', () => {
		const original = new NodeApiError(NODE, { code: 'not_found', message: 'job not found' });
		assert.equal(asNodeError(NODE, original, 0), original);
	});

	it('passes an existing NodeOperationError through untouched', () => {
		const original = new NodeOperationError(NODE, 'bad config');
		assert.equal(asNodeError(NODE, original, 0), original);
	});

	it('wraps an unexpected error so it keeps node context', () => {
		const wrapped = asNodeError(NODE, new Error('socket hang up'), 2);
		assert.ok(wrapped instanceof NodeOperationError);
		assert.match(wrapped.message, /socket hang up/);
	});
});
