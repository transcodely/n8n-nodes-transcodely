import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { buildCreateWebhookEndpointRequest, WEBHOOK_EVENT_TYPES } from './requests';
import {
	DEFAULT_TOLERANCE_SECONDS,
	describeSignatureFailure,
	SIGNATURE_HEADER,
	verifySignature,
} from './signature';
import { getTranscodelyCredentials, resolveAppId, transcodelyApiRequest } from './transport';

const PRIVATE_HOST_PATTERN =
	/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?)/i;

function eventOptions() {
	return [
		{ name: 'All Events', value: '*', description: 'Subscribe to every event type' },
		...WEBHOOK_EVENT_TYPES.map((eventType) => ({
			name: eventType,
			value: eventType,
		})),
	];
}

export class TranscodelyTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Transcodely Trigger',
		name: 'transcodelyTrigger',
		icon: { light: 'file:transcodely.svg', dark: 'file:transcodely.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts a workflow when Transcodely sends a signed webhook event',
		defaults: {
			name: 'Transcodely Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'transcodelyApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['job.succeeded', 'job.failed'],
				options: eventOptions(),
				description: 'Event types this workflow subscribes to',
			},
			{
				displayName:
					'This trigger registers a webhook endpoint on your Transcodely app. Transcodely only delivers to public HTTPS URLs, so a self-hosted n8n behind a LAN cannot receive events — see the README for the polling alternative.',
				name: 'publicUrlNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Endpoint Description',
						name: 'endpointDescription',
						type: 'string',
						default: '',
						description: 'Label stored on the Transcodely webhook endpoint',
					},
					{
						displayName: 'Replay Window (Seconds)',
						name: 'toleranceSeconds',
						type: 'number',
						typeOptions: { minValue: 0 },
						default: DEFAULT_TOLERANCE_SECONDS,
						description:
							'How far a delivery timestamp may drift from now before the request is rejected. Set 0 only to debug a clock problem.',
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const endpointId = typeof staticData.webhookId === 'string' ? staticData.webhookId : '';
				if (endpointId === '' || typeof staticData.webhookSecret !== 'string') {
					return false;
				}

				const webhookUrl = this.getNodeWebhookUrl('default');
				const { baseUrl } = await getTranscodelyCredentials(this);

				try {
					const response = await transcodelyApiRequest(
						this,
						'WebhookService',
						'RetrieveWebhookEndpoint',
						{ id: endpointId },
						{ baseUrl },
					);
					const endpoint = (response.endpoint ?? {}) as IDataObject;
					return endpoint.url === webhookUrl && endpoint.status === 'enabled';
				} catch (error) {
					this.logger.debug(
						`Transcodely Trigger: stored endpoint ${endpointId} is unusable, registering a new one (${(error as Error).message})`,
					);
					return false;
				}
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				if (!webhookUrl || !webhookUrl.startsWith('https://')) {
					throw new NodeOperationError(
						this.getNode(),
						'Transcodely can only deliver webhooks to a public HTTPS URL',
						{
							description:
								'This n8n instance produced a non-HTTPS webhook URL. Put n8n behind a public HTTPS host, or replace this trigger with a Schedule Trigger plus the Transcodely node set to Wait for Completion.',
						},
					);
				}

				const host = webhookUrl.replace(/^https:\/\//, '');
				if (PRIVATE_HOST_PATTERN.test(host)) {
					throw new NodeOperationError(
						this.getNode(),
						'Transcodely refuses webhook URLs that point at a private address',
						{
							description:
								'The webhook URL resolves to a loopback or private-range host that Transcodely rejects. Expose n8n on a public hostname, or poll with the Transcodely node set to Wait for Completion.',
						},
					);
				}

				const events = this.getNodeParameter('events') as string[];
				const options = this.getNodeParameter('options', {}) as IDataObject;
				const { baseUrl } = await getTranscodelyCredentials(this);
				const appId = await resolveAppId(this);

				const response = await transcodelyApiRequest(
					this,
					'WebhookService',
					'CreateWebhookEndpoint',
					buildCreateWebhookEndpointRequest({
						appId,
						url: webhookUrl,
						events,
						description:
							(options.endpointDescription as string | undefined) ??
							`n8n workflow ${this.getWorkflow().name ?? ''}`.trim(),
					}),
					{ baseUrl },
				);

				const endpoint = (response.endpoint ?? {}) as IDataObject;
				const endpointId = typeof endpoint.id === 'string' ? endpoint.id : '';
				const secret = typeof endpoint.secret === 'string' ? endpoint.secret : '';

				if (endpointId === '' || secret === '') {
					throw new NodeOperationError(
						this.getNode(),
						'Transcodely did not return a usable webhook endpoint',
						{
							description:
								'The endpoint was created without an ID or signing secret, so deliveries could not be verified. Delete any endpoint left behind in the Transcodely dashboard and try again.',
						},
					);
				}

				const staticData = this.getWorkflowStaticData('node');
				staticData.webhookId = endpointId;
				staticData.webhookSecret = secret;
				staticData.webhookEvents = events;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const endpointId = typeof staticData.webhookId === 'string' ? staticData.webhookId : '';
				if (endpointId === '') {
					return true;
				}

				const { baseUrl } = await getTranscodelyCredentials(this);
				try {
					await transcodelyApiRequest(
						this,
						'WebhookService',
						'DeleteWebhookEndpoint',
						{ id: endpointId },
						{ baseUrl },
					);
				} catch (error) {
					this.logger.warn(
						`Transcodely Trigger: could not delete endpoint ${endpointId}, remove it in the Transcodely dashboard (${(error as Error).message})`,
					);
					return false;
				} finally {
					delete staticData.webhookId;
					delete staticData.webhookSecret;
					delete staticData.webhookEvents;
				}

				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const response = this.getResponseObject();
		const headers = this.getHeaderData();
		const body = this.getBodyData();
		const staticData = this.getWorkflowStaticData('node');
		const options = this.getNodeParameter('options', {}) as IDataObject;

		const secret = typeof staticData.webhookSecret === 'string' ? staticData.webhookSecret : '';
		if (secret === '') {
			this.logger.warn(
				'Transcodely Trigger: no signing secret is stored for this workflow, rejecting the delivery',
			);
			response.status(401).send('signature could not be verified');
			return { noWebhookResponse: true };
		}

		const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
		const payload: string | Buffer =
			rawBody instanceof Buffer && rawBody.length > 0 ? rawBody : JSON.stringify(body);

		const toleranceSeconds =
			typeof options.toleranceSeconds === 'number'
				? options.toleranceSeconds
				: DEFAULT_TOLERANCE_SECONDS;

		const verification = verifySignature({
			header: headers[SIGNATURE_HEADER] as string | undefined,
			payload,
			secrets: [secret],
			nowSeconds: Math.floor(Date.now() / 1000),
			toleranceSeconds,
		});

		if (!verification.valid) {
			this.logger.warn(
				`Transcodely Trigger: rejected a delivery. ${describeSignatureFailure(verification.reason)}`,
			);
			response.status(401).send('signature could not be verified');
			return { noWebhookResponse: true };
		}

		return {
			workflowData: [this.helpers.returnJsonArray(body)],
		};
	}
}
