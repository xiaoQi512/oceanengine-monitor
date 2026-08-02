import { pathToFileURL } from 'node:url';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import('../src/db/v2/refresh-views.mjs');
}
