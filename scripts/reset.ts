import fs from 'node:fs';
import path from 'node:path';

/**
 * Destroys the embedded database directory. Refuses to run against a directory
 * that does not look like the FICAP data directory, and refuses in live mode
 * unless --force is supplied.
 */
const target = path.resolve(process.env.FICAP_DATA_DIR || '.data/pglite');
const force = process.argv.includes('--force');
const live = (process.env.FICAP_MODE ?? 'demo') === 'live';

if (!target.includes('.data')) {
  console.error(`[ficap] refusing to delete ${target}: it does not look like a FICAP data directory`);
  process.exit(1);
}
if (live && !force) {
  console.error('[ficap] refusing to reset a live database without --force');
  process.exit(1);
}

if (fs.existsSync(target)) {
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`[ficap] removed ${target}`);
} else {
  console.log(`[ficap] ${target} does not exist; nothing to remove`);
}
console.log('[ficap] run "npm run db:migrate" and "npm run db:seed" to rebuild the demonstration estate.');
