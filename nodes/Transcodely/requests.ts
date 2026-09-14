import type { IDataObject } from 'n8n-workflow';

export const DEFAULT_BASE_URL = 'https://api.transcodely.com';

/** Job statuses the API never moves away from. */
export const TERMINAL_JOB_STATUSES = ['completed', 'failed', 'canceled', 'partial'] as const;

/**
 * A delayed-start job parks here until `ConfirmJob` is called, so polling can
 * never make progress on its own. Treated as an end state by Wait for Job.
 */
export const STALLED_JOB_STATUS = 'awaiting_confirmation';

/** Every concrete webhook event type the API emits, plus the wildcard. */
export const WEBHOOK_EVENT_TYPES = [
	'job.created',
	'job.succeeded',
	'job.failed',
	'job.canceled',
	'job.progress',
	'output.created',
	'output.ready',
	'output.failed',
	'output.progress',
	'video.uploaded',
	'video.ready',
	'video.failed',
	'video.deleted',
	'video.source_scheduled_for_deletion',
	'app.created',
	'app.updated',
	'app.spend_limit_warning',
	'app.spend_limit_exceeded',
] as const;

export interface MetadataPair {
	name: string;
	value: string;
}

export interface OutputSpecInput {
	preset?: string;
	type?: string;
	codec?: string;
	resolution?: string;
	quality?: string;
	framerate?: number;
	pathTemplate?: string;
}

export interface CreateJobParams {
	inputMode: 'url' | 'origin' | 'video';
	inputUrl?: string;
	inputOriginId?: string;
	inputPath?: string;
	inputVideoId?: string;
	deliveryMode: 'managed' | 'origin';
	outputOriginId?: string;
	outputPathTemplate?: string;
	outputs: OutputSpecInput[];
	priority?: string;
	idempotencyKey?: string;
	delayedStart?: boolean;
	metadata?: MetadataPair[];
	appId?: string;
}

export interface CreateVideoFromUrlParams {
	appId: string;
	url: string;
	title?: string;
	description?: string;
	visibility?: string;
	preset?: string;
	autoCaptions?: boolean;
	hoverPreviews?: boolean;
	tags?: string[];
}

export interface ListJobsParams {
	limit?: number;
	cursor?: string;
	statuses?: string[];
	appId?: string;
	createdAfter?: string;
	createdBefore?: string;
	metadata?: MetadataPair[];
}

/** Strips a trailing slash and falls back to the public API host. */
export function normalizeBaseUrl(raw?: string): string {
	const trimmed = (raw ?? '').trim();
	const base = trimmed === '' ? DEFAULT_BASE_URL : trimmed;
	return base.replace(/\/+$/, '');
}

export type BaseUrlCheck = { ok: true; baseUrl: string } | { ok: false; reason: string };

/**
 * Validates the credential's base URL before any bearer token is sent to it.
 *
 * The API key travels as an Authorization header on every request, so the host
 * it is handed to must be plaintext-proof and must be an API root: a value
 * carrying a path would silently prefix every procedure and change which
 * server sees the key.
 */
export function validateBaseUrl(raw?: string): BaseUrlCheck {
	const baseUrl = normalizeBaseUrl(raw);

	if (!baseUrl.startsWith('https://')) {
		return {
			ok: false,
			reason: 'it must start with https:// so the API key is never sent in plaintext',
		};
	}

	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		return { ok: false, reason: 'it is not a valid URL' };
	}

	if (parsed.pathname !== '/' && parsed.pathname !== '') {
		return {
			ok: false,
			reason: 'it must be a host with no path, for example https://api.transcodely.com',
		};
	}
	if (parsed.search !== '' || parsed.hash !== '') {
		return { ok: false, reason: 'it must not carry a query string or fragment' };
	}

	return { ok: true, baseUrl };
}

/** Builds the Connect-RPC URL for one procedure. */
export function rpcUrl(baseUrl: string, service: string, method: string): string {
	return `${normalizeBaseUrl(baseUrl)}/transcodely.v1.${service}/${method}`;
}

function toMetadataMap(pairs?: MetadataPair[]): IDataObject | undefined {
	if (!pairs || pairs.length === 0) {
		return undefined;
	}
	const map: IDataObject = {};
	for (const pair of pairs) {
		const key = (pair?.name ?? '').trim();
		if (key === '') {
			continue;
		}
		map[key] = pair.value ?? '';
	}
	return Object.keys(map).length > 0 ? map : undefined;
}

/** Turns one UI output row into an OutputSpec. */
export function buildOutputSpec(output: OutputSpecInput): IDataObject {
	const spec: IDataObject = {};
	const preset = (output.preset ?? '').trim();

	if (preset !== '') {
		spec.preset = preset;
	} else {
		spec.type = output.type ?? 'hls';
		const variant: IDataObject = {
			codec: output.codec ?? 'h264',
			resolution: output.resolution ?? '1080p',
			quality: output.quality ?? 'standard',
		};
		if (typeof output.framerate === 'number' && output.framerate > 0) {
			variant.framerate = output.framerate;
		}
		spec.video = [variant];
	}

	const pathTemplate = (output.pathTemplate ?? '').trim();
	if (pathTemplate !== '') {
		spec.path_template = pathTemplate;
	}

	return spec;
}

/**
 * Builds a `JobService.Create` request body. Exactly one input source and
 * exactly one delivery target are ever set, matching the CEL rules the API
 * validates the message against.
 */
export function buildCreateJobRequest(params: CreateJobParams): IDataObject {
	const body: IDataObject = {
		outputs: params.outputs.map(buildOutputSpec),
	};

	if (params.inputMode === 'url') {
		body.input_url = params.inputUrl ?? '';
	} else if (params.inputMode === 'origin') {
		body.input_origin_id = params.inputOriginId ?? '';
		const inputPath = (params.inputPath ?? '').trim();
		if (inputPath !== '') {
			body.input_path = inputPath;
		}
	} else {
		body.input_video_id = params.inputVideoId ?? '';
	}

	if (params.deliveryMode === 'managed') {
		body.managed = true;
	} else {
		body.output_origin_id = params.outputOriginId ?? '';
	}

	const outputPathTemplate = (params.outputPathTemplate ?? '').trim();
	if (outputPathTemplate !== '') {
		body.output_path_template = outputPathTemplate;
	}

	const priority = (params.priority ?? '').trim();
	if (priority !== '') {
		body.priority = priority;
	}

	const idempotencyKey = (params.idempotencyKey ?? '').trim();
	if (idempotencyKey !== '') {
		body.idempotency_key = idempotencyKey;
	}

	if (params.delayedStart === true) {
		body.delayed_start = true;
	}

	const metadata = toMetadataMap(params.metadata);
	if (metadata) {
		body.metadata = metadata;
	}

	const appId = (params.appId ?? '').trim();
	if (appId !== '') {
		body.app_id = appId;
	}

	return body;
}

/** Builds a `VideoService.CreateFromUrl` request body. */
export function buildCreateVideoFromUrlRequest(params: CreateVideoFromUrlParams): IDataObject {
	const body: IDataObject = {
		app_id: params.appId,
		url: params.url,
	};

	const title = (params.title ?? '').trim();
	if (title !== '') {
		body.title = title;
	}

	const description = (params.description ?? '').trim();
	if (description !== '') {
		body.description = description;
	}

	const visibility = (params.visibility ?? '').trim();
	if (visibility !== '') {
		body.visibility = visibility;
	}

	const preset = (params.preset ?? '').trim();
	if (preset !== '') {
		body.preset = preset;
	}

	if (params.autoCaptions === true) {
		body.auto_captions = true;
	}

	if (params.hoverPreviews === true) {
		body.hover_previews = true;
	}

	const tags = (params.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag !== '');
	if (tags.length > 0) {
		body.tags = tags;
	}

	return body;
}

/** Builds a `JobService.List` request body. */
export function buildListJobsRequest(params: ListJobsParams): IDataObject {
	const pagination: IDataObject = {};
	if (typeof params.limit === 'number' && params.limit > 0) {
		pagination.limit = Math.min(params.limit, 100);
	}
	const cursor = (params.cursor ?? '').trim();
	if (cursor !== '') {
		pagination.cursor = cursor;
	}

	const body: IDataObject = {};
	if (Object.keys(pagination).length > 0) {
		body.pagination = pagination;
	}

	const statuses = (params.statuses ?? []).filter((status) => status !== '');
	if (statuses.length > 0) {
		body.statuses = statuses;
	}

	const appId = (params.appId ?? '').trim();
	if (appId !== '') {
		body.app_id = appId;
	}

	const createdAfter = (params.createdAfter ?? '').trim();
	if (createdAfter !== '') {
		body.created_after = createdAfter;
	}

	const createdBefore = (params.createdBefore ?? '').trim();
	if (createdBefore !== '') {
		body.created_before = createdBefore;
	}

	const metadata = toMetadataMap(params.metadata);
	if (metadata) {
		body.metadata = metadata;
	}

	return body;
}

/**
 * Collapses a subscription list to what the API should store. Selecting the
 * wildcard alongside named events makes the named ones redundant, so only the
 * wildcard is sent.
 */
export function normalizeEventSelection(events: string[]): string[] {
	const cleaned = events.map((event) => event.trim()).filter((event) => event !== '');
	if (cleaned.includes('*')) {
		return ['*'];
	}
	return [...new Set(cleaned)];
}

/** Builds a `WebhookService.CreateWebhookEndpoint` request body. */
export function buildCreateWebhookEndpointRequest(params: {
	appId: string;
	url: string;
	events: string[];
	description?: string;
}): IDataObject {
	const body: IDataObject = {
		app_id: params.appId,
		url: params.url,
		enabled_events: normalizeEventSelection(params.events),
	};

	const description = (params.description ?? '').trim();
	if (description !== '') {
		body.description = description.slice(0, 500);
	}

	return body;
}

/** True once a job can no longer change on its own. */
export function isTerminalJobStatus(status: string): boolean {
	return (
		(TERMINAL_JOB_STATUSES as readonly string[]).includes(status) || status === STALLED_JOB_STATUS
	);
}

/**
 * Poll delay for attempt `attempt` (0-based): an exponential backoff that
 * starts at `initialMs` and is capped at `maxMs`.
 */
export function backoffDelayMs(
	attempt: number,
	initialMs = 2000,
	maxMs = 30000,
	factor = 1.5,
): number {
	const delay = initialMs * Math.pow(factor, Math.max(attempt, 0));
	return Math.min(Math.round(delay), maxMs);
}

/**
 * The delay to actually wait before the next poll: the backoff, shortened so
 * the final poll lands ON the deadline instead of being skipped just short of
 * it. Returns null only when no time is left, which is the one case that is
 * genuinely a timeout.
 */
export function nextPollDelayMs(attempt: number, msRemaining: number): number | null {
	if (msRemaining <= 0) {
		return null;
	}
	return Math.min(backoffDelayMs(attempt), msRemaining);
}
