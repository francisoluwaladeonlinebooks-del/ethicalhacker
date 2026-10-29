import { runSeedScript } from '@/lib/demo/seed';

// The demo estate is written with data_mode = 'demo'. It never touches live
// records: the seed truncates only demonstration tables and is refused in live
// mode by scripts/guard check below.
if ((process.env.FICAP_MODE ?? 'demo') === 'live' && !process.argv.includes('--force')) {
  console.error('[ficap] refusing to seed demonstration data while FICAP_MODE=live (pass --force to override)');
  process.exit(1);
}

void runSeedScript();
