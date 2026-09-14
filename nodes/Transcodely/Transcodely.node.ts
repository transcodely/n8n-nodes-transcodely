import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import { asNodeError } from './errors';
import {
	jobFields,
	jobOperations,
	resourceProperty,
	videoFields,
	videoOperations,
} from './descriptions';
import type { MetadataPair, OutputSpecInput } from './requests';
import {
	backoffDelayMs,
	buildCreateJobRequest,
	buildCreateVideoFromUrlRequest,
	buildListJobsRequest,
	isTerminalJobStatus,
	STALLED_JOB_STATUS,
} from './requests';
import { getTranscodelyCredentials, resolveAppId, transcodelyApiRequest } from './transport';

const MAX_LIST_PAGES = 100;
const UNSUCCESSFUL_JOB_STATUSES = ['failed', 'canceled', 'partial'];

function metadataPairs(collection: IDataObject | undefined): MetadataPair[] {
	const rows = collection?.metadata;
	if (!Array.isArray(rows)) {
		return [];
	}
	return rows.map((row) => {
		const entry = row as IDataObject;
		return {
			name: typeof entry.name === 'string' ? entry.name : '',
			value: typeof entry.value === 'string' ? entry.value : '',
		};
	});
}

function outputRows(collection: IDataObject | undefined): OutputSpecInput[] {
	const rows = collection?.output;
	if (!Array.isArray(rows)) {
		return [];
	}
	return rows.map((row) => {
		const entry = row as IDataObject;
		return {
			preset: typeof entry.preset === 'string' ? entry.preset : undefined,
			type: typeof entry.type === 'string' ? entry.type : undefined,
			codec: typeof entry.codec === 'string' ? entry.codec : undefined,
			resolution: typeof entry.resolution === 'string' ? entry.resolution : undefined,
			quality: typeof entry.quality === 'string' ? entry.quality : undefined,
			framerate: typeof entry.framerate === 'number' ? entry.framerate : undefined,
			pathTemplate: typeof entry.pathTemplate === 'string' ? entry.pathTemplate : undefined,
		};
	});
}

export class Transcodely implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Transcodely',
		name: 'transcodely',
		icon: { light: 'file:transcodely.svg', dark: 'file:transcodely.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Transcode and host video with Transcodely',
		defaults: {
			name: 'Transcodely',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'transcodelyApi',
				required: true,
			},
		],
		properties: [resourceProperty, jobOperations, videoOperations, ...jobFields, ...videoFields],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const { baseUrl } = await getTranscodelyCredentials(this);

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let results: IDataObject[] = [];

				if (resource === 'job' && operation === 'create') {
					results = [await createJob.call(this, i, baseUrl)];
				} else if (resource === 'job' && operation === 'get') {
					const jobId = this.getNodeParameter('jobId', i) as string;
					const response = await transcodelyApiRequest(
						this,
						'JobService',
						'Get',
						{ id: jobId },
						{ itemIndex: i, baseUrl },
					);
					results = [(response.job ?? {}) as IDataObject];
				} else if (resource === 'job' && operation === 'getAll') {
					results = await listJobs.call(this, i, baseUrl);
				} else if (resource === 'job' && operation === 'wait') {
					results = [await waitForJob.call(this, i, baseUrl)];
				} else if (resource === 'video' && operation === 'createFromUrl') {
					results = [await createVideoFromUrl.call(this, i, baseUrl)];
				} else if (resource === 'video' && operation === 'get') {
					const videoId = this.getNodeParameter('videoId', i) as string;
					const response = await transcodelyApiRequest(
						this,
						'VideoService',
						'Get',
						{ id: videoId },
						{ itemIndex: i, baseUrl },
					);
					results = [(response.video ?? {}) as IDataObject];
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not supported for resource "${resource}"`,
						{ itemIndex: i },
					);
				}

				for (const result of results) {
					returnData.push({ json: result, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw asNodeError(this.getNode(), error, i);
			}
		}

		return [returnData];
	}
}

async function createJob(
	this: IExecuteFunctions,
	itemIndex: number,
	baseUrl: string,
): Promise<IDataObject> {
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const outputs = outputRows(this.getNodeParameter('outputs', itemIndex, {}) as IDataObject);

	if (outputs.length === 0) {
		throw new NodeOperationError(this.getNode(), 'At least one output is required', {
			description: 'Add an output row, or reference a preset in one.',
			itemIndex,
		});
	}

	const body = buildCreateJobRequest({
		inputMode: this.getNodeParameter('inputMode', itemIndex) as 'url' | 'origin' | 'video',
		inputUrl: this.getNodeParameter('inputUrl', itemIndex, '') as string,
		inputOriginId: this.getNodeParameter('inputOriginId', itemIndex, '') as string,
		inputPath: this.getNodeParameter('inputPath', itemIndex, '') as string,
		inputVideoId: this.getNodeParameter('inputVideoId', itemIndex, '') as string,
		deliveryMode: this.getNodeParameter('deliveryMode', itemIndex) as 'managed' | 'origin',
		outputOriginId: this.getNodeParameter('outputOriginId', itemIndex, '') as string,
		outputPathTemplate: this.getNodeParameter('outputPathTemplate', itemIndex, '') as string,
		outputs,
		priority: options.priority as string | undefined,
		idempotencyKey: options.idempotencyKey as string | undefined,
		delayedStart: options.delayedStart as boolean | undefined,
		metadata: metadataPairs(options.metadata as IDataObject | undefined),
	});

	const response = await transcodelyApiRequest(this, 'JobService', 'Create', body, {
		itemIndex,
		baseUrl,
	});

	const job = (response.job ?? {}) as IDataObject;
	if (typeof response.video_id === 'string') {
		job.video_id = response.video_id;
	}
	return job;
}

async function createVideoFromUrl(
	this: IExecuteFunctions,
	itemIndex: number,
	baseUrl: string,
): Promise<IDataObject> {
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const rawTags = typeof options.tags === 'string' ? options.tags : '';

	const body = buildCreateVideoFromUrlRequest({
		appId: await resolveAppId(this, { itemIndex }),
		url: this.getNodeParameter('url', itemIndex) as string,
		title: options.title as string | undefined,
		description: options.description as string | undefined,
		visibility: options.visibility as string | undefined,
		preset: options.preset as string | undefined,
		autoCaptions: options.autoCaptions as boolean | undefined,
		hoverPreviews: options.hoverPreviews as boolean | undefined,
		tags: rawTags.split(',').map((tag) => tag.trim()),
	});

	const response = await transcodelyApiRequest(this, 'VideoService', 'CreateFromUrl', body, {
		itemIndex,
		baseUrl,
	});

	return (response.video ?? {}) as IDataObject;
}

async function listJobs(
	this: IExecuteFunctions,
	itemIndex: number,
	baseUrl: string,
): Promise<IDataObject[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = returnAll ? 100 : (this.getNodeParameter('limit', itemIndex, 50) as number);
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;

	const collected: IDataObject[] = [];
	let cursor = '';

	for (let page = 0; page < MAX_LIST_PAGES; page++) {
		const body = buildListJobsRequest({
			limit: returnAll ? 100 : Math.min(limit - collected.length, 100),
			cursor,
			statuses: (filters.statuses as string[] | undefined) ?? [],
			createdAfter: filters.createdAfter as string | undefined,
			createdBefore: filters.createdBefore as string | undefined,
		});

		const response = await transcodelyApiRequest(this, 'JobService', 'List', body, {
			itemIndex,
			baseUrl,
		});

		const jobs = Array.isArray(response.jobs) ? (response.jobs as IDataObject[]) : [];
		collected.push(...jobs);

		const pagination = (response.pagination ?? {}) as IDataObject;
		cursor = typeof pagination.next_cursor === 'string' ? pagination.next_cursor : '';

		if (!returnAll && collected.length >= limit) {
			return collected.slice(0, limit);
		}
		if (cursor === '' || jobs.length === 0) {
			break;
		}
	}

	return returnAll ? collected : collected.slice(0, limit);
}

async function waitForJob(
	this: IExecuteFunctions,
	itemIndex: number,
	baseUrl: string,
): Promise<IDataObject> {
	const jobId = this.getNodeParameter('jobId', itemIndex) as string;
	const maxWaitSeconds = this.getNodeParameter('maxWaitSeconds', itemIndex, 900) as number;
	const failOnJobFailure = this.getNodeParameter('failOnJobFailure', itemIndex, true) as boolean;

	const deadline = Date.now() + maxWaitSeconds * 1000;
	let attempt = 0;

	for (;;) {
		const response = await transcodelyApiRequest(
			this,
			'JobService',
			'Get',
			{ id: jobId },
			{ itemIndex, baseUrl },
		);
		const job = (response.job ?? {}) as IDataObject;
		const status = typeof job.status === 'string' ? job.status : '';

		if (isTerminalJobStatus(status)) {
			if (failOnJobFailure && UNSUCCESSFUL_JOB_STATUSES.includes(status)) {
				const reason =
					typeof job.error_message === 'string' && job.error_message !== ''
						? job.error_message
						: `Job ${jobId} ended as ${status}`;
				throw new NodeOperationError(this.getNode(), reason, {
					description:
						typeof job.error_code === 'string' && job.error_code !== ''
							? `Transcodely error code: ${job.error_code}`
							: undefined,
					itemIndex,
				});
			}
			if (status === STALLED_JOB_STATUS) {
				job.wait_note =
					'The job is awaiting confirmation and will not progress until it is confirmed';
			}
			return job;
		}

		const delay = backoffDelayMs(attempt);
		if (Date.now() + delay > deadline) {
			throw new NodeOperationError(
				this.getNode(),
				`Job ${jobId} did not finish within ${maxWaitSeconds} seconds`,
				{
					description: `Last observed status: ${status || 'unknown'}. Raise "Max Wait (Seconds)" or use the Transcodely Trigger instead of polling.`,
					itemIndex,
				},
			);
		}

		await sleep(delay);
		attempt++;
	}
}
