import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	DEFAULT_TOLERANCE_SECONDS,
	describeSignatureFailure,
	parseSignatureHeader,
	signPayload,
	verifySignature,
} from '../nodes/Transcodely/signature';

const SECRET = 'whsec_hq7Wm2hVQeWnpYQmKQwq0k0wq9tQ0bJf5wZ4Yb0Qm1c';
const PREVIOUS_SECRET = 'whsec_previous_rotation_secret_value_for_overlap';
const BODY = '{"id":"evt_a1b2c3d4e5f6g7h8","object":"event","type":"job.succeeded"}';
const TS = 1789000000;

/** Independent reference implementation, so the test does not reuse signPayload. */
function referenceSignature(secret: string, body: string, timestamp: number): string {
	return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

describe('signPayload', () => {
	it('matches an independently computed HMAC over "<ts>.<body>"', () => {
		assert.equal(signPayload(SECRET, BODY, TS), referenceSignature(SECRET, BODY, TS));
	});

	it('keys the HMAC with the whsec_ prefix included', () => {
		const withoutPrefix = referenceSignature(SECRET.replace('whsec_', ''), BODY, TS);
		assert.notEqual(signPayload(SECRET, BODY, TS), withoutPrefix);
	});

	it('signs a Buffer payload identically to the same bytes as a string', () => {
		assert.equal(signPayload(SECRET, Buffer.from(BODY, 'utf8'), TS), signPayload(SECRET, BODY, TS));
	});
});

describe('parseSignatureHeader', () => {
	it('reads the timestamp and every v1 entry', () => {
		const parsed = parseSignatureHeader(`t=${TS},v1=aaa,v1=bbb`);
		assert.equal(parsed.timestamp, TS);
		assert.deepEqual(parsed.signatures, ['aaa', 'bbb']);
	});

	it('tolerates surrounding whitespace', () => {
		const parsed = parseSignatureHeader(` t=${TS} , v1=aaa `);
		assert.equal(parsed.timestamp, TS);
		assert.deepEqual(parsed.signatures, ['aaa']);
	});

	it('reports a non-numeric timestamp as absent', () => {
		assert.equal(parseSignatureHeader('t=later,v1=aaa').timestamp, null);
	});

	it('rejects timestamp spellings the API signer can never produce', () => {
		// The API writes strconv.FormatInt output and parses with base-10
		// ParseInt, so hex, exponent and empty forms are not timestamps here
		// either, however willing JavaScript's Number() is to read them.
		for (const raw of ['0x10', '1e9', '', ' ', '+1789000000', '1789000000.5', '-1']) {
			assert.equal(parseSignatureHeader(`t=${raw},v1=aaa`).timestamp, null, raw);
		}
	});
});

describe('verifySignature', () => {
	const header = `t=${TS},v1=${referenceSignature(SECRET, BODY, TS)}`;

	it('accepts a correctly signed delivery', () => {
		const result = verifySignature({
			header,
			payload: BODY,
			secrets: [SECRET],
			nowSeconds: TS + 5,
		});
		assert.deepEqual(result, { valid: true });
	});

	it('accepts the rotation-overlap header where only the second v1 matches', () => {
		const rotated = `t=${TS},v1=${referenceSignature(PREVIOUS_SECRET, BODY, TS)},v1=${referenceSignature(SECRET, BODY, TS)}`;
		const result = verifySignature({
			header: rotated,
			payload: BODY,
			secrets: [SECRET],
			nowSeconds: TS,
		});
		assert.deepEqual(result, { valid: true });
	});

	it('rejects a tampered payload', () => {
		const result = verifySignature({
			header,
			payload: BODY.replace('succeeded', 'failed'),
			secrets: [SECRET],
			nowSeconds: TS,
		});
		assert.deepEqual(result, { valid: false, reason: 'no_valid_signature' });
	});

	it('rejects a signature made with a different secret', () => {
		const result = verifySignature({
			header,
			payload: BODY,
			secrets: [PREVIOUS_SECRET],
			nowSeconds: TS,
		});
		assert.deepEqual(result, { valid: false, reason: 'no_valid_signature' });
	});

	it('rejects a replayed delivery outside the tolerance window', () => {
		const result = verifySignature({
			header,
			payload: BODY,
			secrets: [SECRET],
			nowSeconds: TS + DEFAULT_TOLERANCE_SECONDS + 1,
		});
		assert.deepEqual(result, { valid: false, reason: 'timestamp_out_of_tolerance' });
	});

	it('rejects a delivery timestamped too far in the future', () => {
		const result = verifySignature({
			header,
			payload: BODY,
			secrets: [SECRET],
			nowSeconds: TS - DEFAULT_TOLERANCE_SECONDS - 1,
		});
		assert.deepEqual(result, { valid: false, reason: 'timestamp_out_of_tolerance' });
	});

	it('skips the replay check when the tolerance is zero', () => {
		const result = verifySignature({
			header,
			payload: BODY,
			secrets: [SECRET],
			nowSeconds: TS + 99999,
			toleranceSeconds: 0,
		});
		assert.deepEqual(result, { valid: true });
	});

	it('rejects a missing header', () => {
		const result = verifySignature({
			header: undefined,
			payload: BODY,
			secrets: [SECRET],
			nowSeconds: TS,
		});
		assert.deepEqual(result, { valid: false, reason: 'missing_header' });
	});

	it('rejects a header with no timestamp', () => {
		const result = verifySignature({
			header: `v1=${referenceSignature(SECRET, BODY, TS)}`,
			payload: BODY,
			secrets: [SECRET],
			nowSeconds: TS,
		});
		assert.deepEqual(result, { valid: false, reason: 'missing_timestamp' });
	});

	it('rejects a header with no v1 entry', () => {
		const result = verifySignature({
			header: `t=${TS}`,
			payload: BODY,
			secrets: [SECRET],
			nowSeconds: TS,
		});
		assert.deepEqual(result, { valid: false, reason: 'missing_signature' });
	});

	it('rejects a signature of the wrong length without throwing', () => {
		const result = verifySignature({
			header: `t=${TS},v1=abc`,
			payload: BODY,
			secrets: [SECRET],
			nowSeconds: TS,
		});
		assert.deepEqual(result, { valid: false, reason: 'no_valid_signature' });
	});

	it('ignores empty secrets in the candidate list', () => {
		const result = verifySignature({
			header,
			payload: BODY,
			secrets: ['', SECRET],
			nowSeconds: TS,
		});
		assert.deepEqual(result, { valid: true });
	});
});

describe('describeSignatureFailure', () => {
	it('names every failure reason', () => {
		for (const reason of [
			'missing_header',
			'missing_timestamp',
			'missing_signature',
			'timestamp_out_of_tolerance',
			'no_valid_signature',
		] as const) {
			assert.ok(describeSignatureFailure(reason).length > 0);
		}
	});
});
