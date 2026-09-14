import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { describeApiError, formatApiError } from './errors';
import { buildListJobsRequest, normalizeBaseUrl, rpcUrl } from './requests';

export const CREDENTIALS_NAME = 'transcodelyApi';

/**
 * Calendar API version this node is written against. Transcodely resolves an
 * unpinned request to whatever is current, so pinning keeps a future breaking
 * date from changing the shape of a running workflow.
 */
export const API_VERSION = '2026-05-03';

export type TranscodelyContext =
	| IExecuteFunctions
	| IHookFunctions
	| ILoadOptionsFunctions
	| IWebhookFunctions;

interface TranscodelyCredentials {
	apiKey: string;
	baseUrl?: string;
	appId?: string;
}

/** Reads the node's credential, with the base URL already normalized. */
export async function getTranscodelyCredentials(
	context: TranscodelyContext,
): Promise<{ baseUrl: string; appId: string }> {
	const credentials = (await context.getCredentials(
		CREDENTIALS_NAME,
	)) as unknown as TranscodelyCredentials;
	return {
		baseUrl: normalizeBaseUrl(credentials?.baseUrl),
		appId: (credentials?.appId ?? '').trim(),
	};
}

/**
 * Calls one Connect-RPC procedure and returns its decoded response.
 *
 * Authentication is delegated to the credential so the API key never passes
 * through node code. A non-2xx answer is translated into a NodeApiError
 * carrying the API's own error code and customer-facing message; the raw
 * response body is never surfaced.
 */
export async function transcodelyApiRequest(
	context: TranscodelyContext,
	service: string,
	method: string,
	body: IDataObject,
	options: { itemIndex?: number; baseUrl?: string } = {},
): Promise<IDataObject> {
	const baseUrl = options.baseUrl ?? (await getTranscodelyCredentials(context)).baseUrl;

	const response = (await context.helpers.httpRequestWithAuthentication.call(
		context,
		CREDENTIALS_NAME,
		{
			method: 'POST',
			url: rpcUrl(baseUrl, service, method),
			headers: {
				'Content-Type': 'application/json',
				'Transcodely-Version': API_VERSION,
			},
			body,
			json: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		},
	)) as { statusCode: number; headers: Record<string, unknown>; body: unknown };

	if (response.statusCode >= 400) {
		const info = describeApiError(response.statusCode, response.headers, response.body);
		throw new NodeApiError(
			context.getNode(),
			{ code: info.code, message: info.message } as JsonObject,
			{
				message: formatApiError(info),
				description: `${service}.${method} was refused by the Transcodely API.`,
				httpCode: String(info.statusCode),
				itemIndex: options.itemIndex,
			},
		);
	}

	return (response.body ?? {}) as IDataObject;
}

/**
 * Resolves the app an operation should act on.
 *
 * `JobService.Create` accepts an app-scoped API key on its own, but
 * `VideoService.CreateFromUrl` and `WebhookService.CreateWebhookEndpoint` still
 * require an explicit `app_id`. The credential's App ID is used when set;
 * otherwise the app is read off the most recent job, which an app-scoped key
 * can always list. An account with no jobs yet must fill the credential field.
 */
export async function resolveAppId(
	context: TranscodelyContext,
	options: { itemIndex?: number } = {},
): Promise<string> {
	const { baseUrl, appId } = await getTranscodelyCredentials(context);
	if (appId !== '') {
		return appId;
	}

	const response = await transcodelyApiRequest(
		context,
		'JobService',
		'List',
		buildListJobsRequest({ limit: 1 }),
		{ itemIndex: options.itemIndex, baseUrl },
	);

	const jobs = Array.isArray(response.jobs) ? (response.jobs as IDataObject[]) : [];
	const discovered = typeof jobs[0]?.app_id === 'string' ? (jobs[0].app_id as string) : '';
	if (discovered !== '') {
		return discovered;
	}

	throw new NodeOperationError(context.getNode(), 'Could not determine which app to use', {
		description:
			'This operation needs an app ID and the account has no job to read one from. Open the Transcodely credential and fill in the App ID field (it looks like app_xxxxxxxxxx).',
		itemIndex: options.itemIndex,
	});
}
