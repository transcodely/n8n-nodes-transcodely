#!/usr/bin/env node
/**
 * Runs the n8n verification scanner's static-analysis leg against this checkout.
 *
 * `npx @n8n/scan-community-package <name>` resolves a PUBLISHED package from the
 * npm registry and checks its provenance attestation first, so it cannot run
 * before a release. This calls the same scanner's `analyzePackage` over the
 * local source with the scanner's own file patterns, which is the part a pull
 * request can actually gate on. The provenance leg still runs post-publish.
 */
import { analyzePackage, SOURCE_FILE_PATTERNS } from '@n8n/scan-community-package/scanner/scanner.mjs';

const packageDir = process.argv[2] ?? process.cwd();
const result = await analyzePackage(packageDir, SOURCE_FILE_PATTERNS);

if (result.passed) {
	console.log('scan-community-package: static analysis passed');
	process.exit(0);
}

console.error(`scan-community-package: ${result.message}`);
if (result.details) {
	console.error(result.details);
}
process.exit(1);
