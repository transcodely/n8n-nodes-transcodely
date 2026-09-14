import type { INodeProperties } from 'n8n-workflow';

const showFor = (resource: string, operations: string[]) => ({
	show: { resource: [resource], operation: operations },
});

export const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{ name: 'Job', value: 'job' },
		{ name: 'Video', value: 'video' },
	],
	default: 'job',
};

export const jobOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['job'] } },
	options: [
		{
			name: 'Create',
			value: 'create',
			description: 'Submit a transcoding job',
			action: 'Create a job',
		},
		{
			name: 'Get',
			value: 'get',
			description: 'Retrieve a single job',
			action: 'Get a job',
		},
		{
			name: 'Get Many',
			value: 'getAll',
			description: 'List jobs in the app',
			action: 'Get many jobs',
		},
		{
			name: 'Wait for Completion',
			value: 'wait',
			description: 'Poll a job until it reaches an end state',
			action: 'Wait for a job to finish',
		},
	],
	default: 'create',
};

export const videoOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['video'] } },
	options: [
		{
			name: 'Create From URL',
			value: 'createFromUrl',
			description: 'Ingest a publicly reachable URL as a hosted video',
			action: 'Create a video from a URL',
		},
		{
			name: 'Get',
			value: 'get',
			description: 'Retrieve a single video',
			action: 'Get a video',
		},
	],
	default: 'createFromUrl',
};

export const jobFields: INodeProperties[] = [
	{
		displayName: 'Input Source',
		name: 'inputMode',
		type: 'options',
		options: [
			{ name: 'URL', value: 'url', description: 'A gs://, s3:// or https:// source URL' },
			{
				name: 'Origin and Path',
				value: 'origin',
				description: 'A file inside a configured storage origin',
			},
			{ name: 'Hosted Video', value: 'video', description: 'An existing Transcodely video' },
		],
		default: 'url',
		displayOptions: showFor('job', ['create']),
	},
	{
		displayName: 'Input URL',
		name: 'inputUrl',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'https://example.com/source.mp4',
		displayOptions: { show: { resource: ['job'], operation: ['create'], inputMode: ['url'] } },
		description: 'Source file to transcode. Supported schemes: gs://, s3://, https://.',
	},
	{
		displayName: 'Input Origin ID',
		name: 'inputOriginId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'ori_xxxxxxxxxxxx',
		displayOptions: { show: { resource: ['job'], operation: ['create'], inputMode: ['origin'] } },
		description: 'Storage origin that holds the source file. It must have read permission.',
	},
	{
		displayName: 'Input Path',
		name: 'inputPath',
		type: 'string',
		default: '',
		placeholder: 'uploads/source.mp4',
		displayOptions: { show: { resource: ['job'], operation: ['create'], inputMode: ['origin'] } },
		description: 'Path to the source file inside the input origin',
	},
	{
		displayName: 'Input Video ID',
		name: 'inputVideoId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'vid_xxxxxxxxxxxxxx',
		displayOptions: { show: { resource: ['job'], operation: ['create'], inputMode: ['video'] } },
		description: 'Hosted video to re-encode. Outputs are written to its managed storage.',
	},
	{
		displayName: 'Delivery',
		name: 'deliveryMode',
		type: 'options',
		options: [
			{
				name: 'Transcodely Managed Storage',
				value: 'managed',
				description: 'Outputs are hosted and delivered over the Transcodely CDN',
			},
			{
				name: 'My Own Storage',
				value: 'origin',
				description: 'Outputs are written to a storage origin you configured',
			},
		],
		default: 'managed',
		displayOptions: showFor('job', ['create']),
		description:
			'Where the renditions are written. Managed storage is provisioned on the first job that asks for it.',
	},
	{
		displayName: 'Output Origin ID',
		name: 'outputOriginId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'ori_xxxxxxxxxxxx',
		displayOptions: {
			show: { resource: ['job'], operation: ['create'], deliveryMode: ['origin'] },
		},
		description: 'Storage origin that receives the outputs. It must have write permission.',
	},
	{
		displayName: 'Output Path Template',
		name: 'outputPathTemplate',
		type: 'string',
		default: '',
		placeholder: 'videos/{job_id}',
		displayOptions: {
			show: { resource: ['job'], operation: ['create'], deliveryMode: ['origin'] },
		},
		description:
			'Job-wide prefix for every output. Variables: {job_id}, {output_id}, {date}, {format}, {codec}, {resolution}, {quality}.',
	},
	{
		displayName: 'Outputs',
		name: 'outputs',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		placeholder: 'Add Output',
		default: {
			output: [
				{ preset: '', type: 'hls', codec: 'h264', resolution: '1080p', quality: 'standard' },
			],
		},
		displayOptions: showFor('job', ['create']),
		description: 'Renditions to produce. Between one and ten per job.',
		options: [
			{
				displayName: 'Output',
				name: 'output',
				values: [
					{
						displayName: 'Container',
						name: 'type',
						type: 'options',
						options: [
							{
								name: 'Adaptive (HLS	+	DASH)',
								value: 'adaptive',
							},
							{
								name: 'DASH',
								value: 'dash',
							},
							{
								name: 'HLS',
								value: 'hls',
							},
							{
								name: 'MKV',
								value: 'mkv',
							},
							{
								name: 'MOV',
								value: 'mov',
							},
							{
								name: 'MP4',
								value: 'mp4',
							},
							{
								name: 'WebM',
								value: 'webm',
							},
						],
						default: 'hls',
						description: 'Container or streaming format for this output',
					},
					{
						displayName: 'Framerate',
						name: 'framerate',
						type: 'number',
						default: 0,
						description: 'Target frame rate. Leave at 0 to keep the source frame rate.',
					},
					{
						displayName: 'Path Template',
						name: 'pathTemplate',
						type: 'string',
						default: '',
						placeholder: '{codec}-{resolution}',
						description:
							'Per-output path template, appended to the job-level template when both are set',
					},
					{
						displayName: 'Preset',
						name: 'preset',
						type: 'string',
						default: '',
						placeholder: 'pst_xxxxxxxxxx or gaming_1080p_60_standard',
						description:
							'Preset ID or slug. When set, the preset drives the encode and the fields below are ignored.',
					},
					{
						displayName: 'Quality Tier',
						name: 'quality',
						type: 'options',
						options: [
							{
								name: 'Economy',
								value: 'economy',
							},
							{
								name: 'Standard',
								value: 'standard',
							},
							{
								name: 'Premium',
								value: 'premium',
							},
						],
						default: 'standard',
						description: 'Encoding quality tier. It affects both speed and price.',
					},
					{
						displayName: 'Resolution',
						name: 'resolution',
						type: 'options',
						options: [
							{ name: '1080p', value: '1080p' },
							{ name: '1440p', value: '1440p' },
							{ name: '2160p (4K)', value: '2160p' },
							{ name: '4320p (8K)', value: '4320p' },
							{ name: '480p', value: '480p' },
							{ name: '720p', value: '720p' },
						],
						default: '1080p',
						description: 'Target resolution for this output',
					},
					{
						displayName: 'Video Codec',
						name: 'codec',
						type: 'options',
						options: [
							{
								name: 'AV1',
								value: 'av1',
							},
							{
								name: 'H.264',
								value: 'h264',
							},
							{
								name: 'H.265',
								value: 'h265',
							},
							{
								name: 'VP9',
								value: 'vp9',
							},
						],
						default: 'h264',
						description: 'Video codec for this output',
					},
				],
			},
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showFor('job', ['create']),
		options: [
			{
				displayName: 'Delayed Start',
				name: 'delayedStart',
				type: 'boolean',
				default: false,
				description:
					'Whether to pause the job after probing so the estimated cost can be reviewed. The job then waits for a confirm call.',
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'Repeating a create with the same key returns the job that was already created',
			},
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Metadata',
				default: {},
				description: 'Key-value pairs stored on the job and echoed back on every read',
				options: [
					{
						displayName: 'Metadata',
						name: 'metadata',
						values: [
							{ displayName: 'Name', name: 'name', type: 'string', default: '' },
							{ displayName: 'Value', name: 'value', type: 'string', default: '' },
						],
					},
				],
			},
			{
				displayName: 'Priority',
				name: 'priority',
				type: 'options',
				options: [
					{ name: 'Economy', value: 'economy' },
					{ name: 'Standard', value: 'standard' },
					{ name: 'Premium', value: 'premium' },
				],
				default: 'standard',
				description: 'Scheduling priority. It has no effect on price.',
			},
		],
	},
	{
		displayName: 'Job ID',
		name: 'jobId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'job_xxxxxxxxxxxx',
		displayOptions: showFor('job', ['get', 'wait']),
		description: 'ID of the job to read',
	},
	{
		displayName: 'Max Wait (Seconds)',
		name: 'maxWaitSeconds',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 900,
		displayOptions: showFor('job', ['wait']),
		description: 'How long to keep polling before giving up',
	},
	{
		displayName: 'Fail on Job Failure',
		name: 'failOnJobFailure',
		type: 'boolean',
		default: true,
		displayOptions: showFor('job', ['wait']),
		description:
			'Whether to raise an error when the job ends in failed, canceled or partial. Turn it off to route the job object onward instead.',
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: showFor('job', ['getAll']),
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { resource: ['job'], operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: showFor('job', ['getAll']),
		options: [
			{
				displayName: 'Created After',
				name: 'createdAfter',
				type: 'dateTime',
				default: '',
				description: 'Only return jobs created at or after this time',
			},
			{
				displayName: 'Created Before',
				name: 'createdBefore',
				type: 'dateTime',
				default: '',
				description: 'Only return jobs created at or before this time',
			},
			{
				displayName: 'Statuses',
				name: 'statuses',
				type: 'multiOptions',
				options: [
					{ name: 'Awaiting Confirmation', value: 'awaiting_confirmation' },
					{ name: 'Canceled', value: 'canceled' },
					{ name: 'Completed', value: 'completed' },
					{ name: 'Failed', value: 'failed' },
					{ name: 'Partial', value: 'partial' },
					{ name: 'Pending', value: 'pending' },
					{ name: 'Probing', value: 'probing' },
					{ name: 'Processing', value: 'processing' },
				],
				default: [],
				description: 'Return jobs whose status is any of the selected values',
			},
		],
	},
];

export const videoFields: INodeProperties[] = [
	{
		displayName: 'Source URL',
		name: 'url',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'https://example.com/source.mp4',
		displayOptions: showFor('video', ['createFromUrl']),
		description:
			'Publicly reachable http(s) URL. Transcodely downloads it at transcode time; private addresses are refused.',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showFor('video', ['createFromUrl']),
		options: [
			{
				displayName: 'Auto Captions',
				name: 'autoCaptions',
				type: 'boolean',
				default: false,
				description:
					'Whether to generate AI captions alongside the transcode. Billed per source minute, and only when a track is delivered.',
			},
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				default: '',
				description: 'Description stored on the video',
			},
			{
				displayName: 'Hover Previews',
				name: 'hoverPreviews',
				type: 'boolean',
				default: false,
				description: 'Whether to attach an animated hover preview in addition to the poster. Free.',
			},
			{
				displayName: 'Preset',
				name: 'preset',
				type: 'string',
				default: '',
				placeholder: 'pst_xxxxxxxxxx',
				description: 'Preset ID or slug driving the encode instead of the app default ladder',
			},
			{
				displayName: 'Tags',
				name: 'tags',
				type: 'string',
				default: '',
				description: 'Comma-separated tags stored on the video',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				description: 'Title stored on the video',
			},
			{
				displayName: 'Visibility',
				name: 'visibility',
				type: 'options',
				options: [
					{ name: 'App Default', value: '' },
					{ name: 'Private', value: 'private' },
					{ name: 'Public', value: 'public' },
					{ name: 'Unlisted', value: 'unlisted' },
				],
				default: '',
				description: 'Who may play the video once it is ready',
			},
		],
	},
	{
		displayName: 'Video ID',
		name: 'videoId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'vid_xxxxxxxxxxxxxx',
		displayOptions: showFor('video', ['get']),
		description: 'ID of the video to read',
	},
];
