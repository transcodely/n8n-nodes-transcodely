import type { IDataObject, INode } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

/** Machine-readable code plus the customer-facing message for a failed RPC. */
export interface TranscodelyErrorInfo {
	code: string;
	message: string;
	statusCode: number;
}

const STATUS_FALLBACKS: Record<number, { code: string; message: string }> = {
	401: { code: 'unauthenticated', message: 'The API key was rejected' },
	403: { code: 'permission_denied', message: 'The API key may not act on this resource' },
	404: { code: 'not_found', message: 'The requested resource does not exist' },
	429: { code: 'resource_exhausted', message: 'A limit was reached' },
	500: { code: 'internal', message: 'Transcodely could not complete the request' },
	503: { code: 'unavailable', message: 'Transcodely is temporarily unavailable' },
};

function fieldViolations(body: IDataObject): string[] {
	const details = body.details;
	if (!Array.isArray(details)) {
		return [];
	}
	const messages: string[] = [];
	for (const detail of details) {
		const violations =
			(detail as IDataObject)?.field_violations ?? (detail as IDataObject)?.fieldViolations;
		if (!Array.isArray(violations)) {
			continue;
		}
		for (const violation of violations) {
			const entry = violation as IDataObject;
			const field = typeof entry.field === 'string' ? entry.field : '';
			const description = typeof entry.description === 'string' ? entry.description : '';
			if (field && description) {
				messages.push(`${field}: ${description}`);
			} else if (description) {
				messages.push(description);
			}
		}
	}
	return messages;
}

/**
 * Turns a Connect-RPC error response into the code plus message a workflow
 * author should see. The API stamps a stable discriminator on the `error-code`
 * response header and repeats a Connect code in the body; the header wins
 * because it names the domain error rather than its broad class.
 *
 * Raw response bodies are never surfaced — only the fields the API documents.
 */
export function describeApiError(
	statusCode: number,
	headers: Record<string, unknown> | undefined,
	body: unknown,
): TranscodelyErrorInfo {
	const parsed: IDataObject =
		typeof body === 'object' && body !== null ? (body as IDataObject) : {};
	const headerCode = headers?.['error-code'];

	const bodyCode = typeof parsed.code === 'string' ? parsed.code : '';
	const fallback = STATUS_FALLBACKS[statusCode] ?? {
		code: 'unknown',
		message: 'Transcodely rejected the request',
	};

	const code = (typeof headerCode === 'string' && headerCode) || bodyCode || fallback.code;

	let message =
		typeof parsed.message === 'string' && parsed.message ? parsed.message : fallback.message;
	const violations = fieldViolations(parsed);
	if (violations.length > 0) {
		message = `${message} (${violations.join('; ')})`;
	}

	return { code, message, statusCode };
}

/** One-line summary suitable for a node error title. */
export function formatApiError(info: TranscodelyErrorInfo): string {
	return `Transcodely API error [${info.code}]: ${info.message}`;
}

/**
 * Normalizes anything thrown inside a node into an n8n error type.
 *
 * Errors raised by the transport are already NodeApiError/NodeOperationError
 * and are handed back untouched so their API code and message survive; a
 * genuinely unexpected error is wrapped rather than re-thrown raw, which would
 * lose its node context in the n8n UI.
 */
export function asNodeError(
	node: INode,
	error: unknown,
	itemIndex?: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) {
		return error;
	}
	return new NodeOperationError(node, error as Error, { itemIndex });
}
