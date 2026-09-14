import type { IDataObject, IHttpRequestOptions, INode } from 'n8n-workflow';

export interface MockResponse {
	statusCode?: number;
	headers?: Record<string, unknown>;
	body: unknown;
}

export interface RecordedCall {
	credentialsType: string;
	options: IHttpRequestOptions;
}

export const TEST_NODE = {
	id: 'n1',
	name: 'Transcodely',
	type: 'n8n-nodes-transcodely.transcodely',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
} as INode;

export interface MockContextOptions {
	params?: Record<string, unknown>;
	responses?: MockResponse[];
	credentials?: { apiKey: string; baseUrl?: string; appId?: string };
	items?: IDataObject[];
	continueOnFail?: boolean;
	staticData?: IDataObject;
	headers?: Record<string, string>;
	body?: IDataObject;
	rawBody?: Buffer;
	webhookUrl?: string;
}

export interface MockContext {
	calls: RecordedCall[];
	staticData: IDataObject;
	logs: string[];
	responseStatus: number | null;
	responseBody: unknown;
	[key: string]: unknown;
}

/**
 * Builds a stand-in for the n8n execution context. Every HTTP call is recorded
 * and answered from a queue, so no request ever leaves the test process.
 */
export function makeContext(options: MockContextOptions = {}): MockContext {
	const responses = [...(options.responses ?? [])];
	const calls: RecordedCall[] = [];
	const logs: string[] = [];
	const staticData: IDataObject = options.staticData ?? {};

	const context: MockContext = {
		calls,
		staticData,
		logs,
		responseStatus: null,
		responseBody: undefined,

		getInputData: () => options.items ?? [{ json: {} }],
		getNode: () => TEST_NODE,
		getWorkflow: () => ({ id: 'w1', name: 'Ingest', active: true }),
		continueOnFail: () => options.continueOnFail === true,
		getWorkflowStaticData: () => staticData,
		getCredentials: async () =>
			options.credentials ?? { apiKey: 'ak_test_key', baseUrl: 'https://api.transcodely.com' },
		getNodeParameter: (name: string, ...rest: unknown[]) => {
			const params = options.params ?? {};
			if (name in params) {
				return params[name];
			}
			// n8n passes (name, itemIndex, fallback) on execute contexts and
			// (name, fallback) on webhook/hook contexts.
			const fallback = rest.length >= 2 ? rest[1] : rest[0];
			return fallback;
		},
		getHeaderData: () => options.headers ?? {},
		getBodyData: () => options.body ?? {},
		getRequestObject: () => ({ rawBody: options.rawBody }),
		getResponseObject: () => ({
			status(code: number) {
				context.responseStatus = code;
				return this;
			},
			send(payload: unknown) {
				context.responseBody = payload;
				return this;
			},
		}),
		getNodeWebhookUrl: () => options.webhookUrl ?? 'https://n8n.example.com/webhook/abc',
		logger: {
			debug: (message: string) => logs.push(`debug:${message}`),
			info: (message: string) => logs.push(`info:${message}`),
			warn: (message: string) => logs.push(`warn:${message}`),
			error: (message: string) => logs.push(`error:${message}`),
		},
		helpers: {
			returnJsonArray: (data: IDataObject | IDataObject[]) =>
				(Array.isArray(data) ? data : [data]).map((json) => ({ json })),
			httpRequestWithAuthentication: async (
				credentialsType: string,
				requestOptions: IHttpRequestOptions,
			) => {
				calls.push({ credentialsType, options: requestOptions });
				const next = responses.shift();
				if (next === undefined) {
					throw new Error(`unexpected HTTP call to ${requestOptions.url}`);
				}
				return {
					statusCode: next.statusCode ?? 200,
					headers: next.headers ?? {},
					body: next.body,
				};
			},
		},
	};

	return context;
}

/** The procedure path of a recorded call, e.g. `JobService/Create`. */
export function procedureOf(call: RecordedCall): string {
	return call.options.url.replace('https://api.transcodely.com/transcodely.v1.', '');
}
