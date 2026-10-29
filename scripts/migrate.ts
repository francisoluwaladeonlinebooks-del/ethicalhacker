import { migrate, databaseSummary } from '@/lib/db/migrate';
import { closeDb } from '@/lib/db/pool';

async function main() {
  console.log('[ficap] applying schema and seeding reference data...');
  await migrate();
  const summary = await databaseSummary();
  console.log('[ficap] database ready');
  for (const [key, value] of Object.entries(summary)) {
    console.log(`  ${key.padEnd(22)} ${typeof value === 'object' ? JSON.stringify(value) : value}`);
  }
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('[ficap] migration failed:', error);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
