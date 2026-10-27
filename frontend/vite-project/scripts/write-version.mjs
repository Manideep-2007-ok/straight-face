// Writes dist/version.json so open pages can tell when a newer build has been deployed.
import { writeFileSync } from 'node:fs';
const build = (process.env.RENDER_GIT_COMMIT || 'dev').slice(0, 7);
writeFileSync(new URL('../dist/version.json', import.meta.url), JSON.stringify({ build }));
console.log('version.json:', build);
