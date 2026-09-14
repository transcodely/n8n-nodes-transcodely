import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class TranscodelyApi implements ICredentialType {
	name = 'transcodelyApi';

	displayName = 'Transcodely API';

	documentationUrl =
		'https://github.com/transcodely/n8n-nodes-transcodely?tab=readme-ov-file#credentials';

	icon = {
		light: 'file:../nodes/Transcodely/transcodely.svg',
		dark: 'file:../nodes/Transcodely/transcodely.dark.svg',
	} as const;

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'ak_...',
			description: 'App-scoped API key from the Transcodely dashboard',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.transcodely.com',
			description:
				'Must be an https:// host with no path. Change it only when pointing at a staging Transcodely API.',
		},
		{
			displayName: 'App ID',
			name: 'appId',
			type: 'string',
			default: '',
			placeholder: 'app_xxxxxxxxxx',
			description:
				'Optional. Create Video From URL and the Transcodely Trigger need an app ID; when this is empty the node reads it from your most recent job. Fill it in if the account has no jobs yet.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/transcodely.v1.JobService/List',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Transcodely-Version': '2026-05-03',
			},
			body: { pagination: { limit: 1 } },
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message: 'The API key was rejected. Check that it is an active ak_ key for this app.',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 403,
					message:
						'The API key is not allowed to read this app. Check which app the key belongs to.',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 404,
					message:
						'No Transcodely API was found at this Base URL. Leave the field empty to use https://api.transcodely.com.',
				},
			},
		],
	};
}
