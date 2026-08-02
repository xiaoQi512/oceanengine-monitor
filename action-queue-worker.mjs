import { pathToFileURL } from 'node:url';

export * from './src/services/action-worker.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import('./src/services/action-worker-cli.mjs');
}
