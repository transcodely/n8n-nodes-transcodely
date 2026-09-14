import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Header names used by Transcodely webhook delivery. Node/Express lower-cases
 * incoming header names, so these are the lower-case forms.
 */
export const SIGNATURE_HEADER = 'transcodely-signature';
export const EVENT_ID_HEADER = 'webhook-id';

/** Replay window the API signs against, in seconds. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignatureFailureReason =
	| 'missing_header'
	| 'missing_timestamp'
	| 'missing_signature'
	| 'timestamp_out_of_tolerance'
	| 'no_valid_signature';

export type SignatureVerification =
	| { valid: true }
	| { valid: false; reason: SignatureFailureReason };

/**
 * Computes the hex HMAC-SHA-256 of `<unix-seconds>.<payload>` keyed by the full
 * signing secret, including its `whsec_` prefix. Mirrors the API's Sign().
 */
export function signPayload(secret: string, payload: string | Buffer, timestamp: number): string {
	const mac = createHmac('sha256', secret);
	mac.update(`${timestamp}.`);
	mac.update(payload);
	return mac.digest('hex');
}

/** Splits a `t=...,v1=...[,v1=...]` header into its timestamp and signatures. */
export function parseSignatureHeader(header: string): {
	timestamp: number | null;
	signatures: string[];
} {
	let timestamp: number | null = null;
	const signatures: string[] = [];

	for (const rawPart of header.split(',')) {
		const part = rawPart.trim();
		if (part.startsWith('t=')) {
			// Digits only, matching the API's strconv.ParseInt(…, 10, 64). Number()
			// alone would also accept "0x10", "1e9" and "", which the signer can
			// never produce — the two parsers must agree on what a timestamp is.
			const raw = part.slice(2);
			timestamp = /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
		} else if (part.startsWith('v1=')) {
			signatures.push(part.slice(3));
		}
	}

	return { timestamp, signatures };
}

function equalsConstantTime(a: string, b: string): boolean {
	const left = Buffer.from(a, 'utf8');
	const right = Buffer.from(b, 'utf8');
	if (left.length !== right.length) {
		return false;
	}
	return timingSafeEqual(left, right);
}

/**
 * Verifies a `Transcodely-Signature` header against the delivered payload.
 *
 * `secrets` may hold more than one value so that the API's 24-hour rotation
 * overlap (two `v1=` entries on one delivery) verifies either way. A
 * `toleranceSeconds` of 0 disables the replay-window check.
 */
export function verifySignature(options: {
	header: string | undefined;
	payload: string | Buffer;
	secrets: string[];
	nowSeconds: number;
	toleranceSeconds?: number;
}): SignatureVerification {
	const { header, payload, secrets, nowSeconds } = options;
	const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;

	if (!header) {
		return { valid: false, reason: 'missing_header' };
	}

	const { timestamp, signatures } = parseSignatureHeader(header);
	if (timestamp === null) {
		return { valid: false, reason: 'missing_timestamp' };
	}
	if (signatures.length === 0) {
		return { valid: false, reason: 'missing_signature' };
	}
	if (tolerance > 0 && Math.abs(nowSeconds - timestamp) > tolerance) {
		return { valid: false, reason: 'timestamp_out_of_tolerance' };
	}

	for (const secret of secrets) {
		if (!secret) {
			continue;
		}
		const expected = signPayload(secret, payload, timestamp);
		for (const candidate of signatures) {
			if (equalsConstantTime(expected, candidate)) {
				return { valid: true };
			}
		}
	}

	return { valid: false, reason: 'no_valid_signature' };
}

/** Human-readable explanation of a failed verification, safe to log. */
export function describeSignatureFailure(reason: SignatureFailureReason): string {
	switch (reason) {
		case 'missing_header':
			return 'Request carried no Transcodely-Signature header';
		case 'missing_timestamp':
			return 'Transcodely-Signature header carried no valid t= timestamp';
		case 'missing_signature':
			return 'Transcodely-Signature header carried no v1= signature';
		case 'timestamp_out_of_tolerance':
			return 'Signature timestamp is outside the replay window';
		case 'no_valid_signature':
			return 'Signature does not match the stored signing secret';
	}
}
