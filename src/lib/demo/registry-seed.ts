/**
 * Synthetic registry dataset for demonstration.
 *
 * Every record below is invented for this environment. Names are not real
 * institutions, licence numbers are placeholders, and no digital asset listed
 * here belongs to anybody. The dataset exists so the registry workflow can be
 * exercised end to end without touching a single real system.
 */
import { withSystem, type Tx } from '@/lib/db/pool';
import type { SessionUser } from '@/lib/rbac';

const SOURCE = 'Synthetic demonstration dataset (FICAP)';
const SOURCE_URL = 'https://example.invalid/ficap/synthetic-registry';

type DemoInstitution = {
  code: string;
  name: string;
  tradingName?: string;
  category: string;
  regulator: string;
  licenceNumber: string;
  licenceCategory: string;
  licenceStatus: string;
  city: string;
  state: string;
  riskTier: string;
  verification: 'verified' | 'provisional' | 'unverified';
  stale?: boolean;
  notes: string;
  assets: {
    type: string;
    name: string;
    identifier: string;
    environment?: string;
    ownership: 'candidate' | 'verified' | 'rejected';
    evidence?: string;
    contact?: string;
    contactEmail?: string;
  }[];
  licenceEvents?: { type: string; effectiveAt: string; note: string }[];
  relationships?: { name: string; relationship: string; note: string }[];
};

const INSTITUTIONS: DemoInstitution[] = [
  {
    code: 'MERIDIAN',
    name: 'Meridian Trust Bank Plc',
    tradingName: 'Meridian Trust',
    category: 'commercial_bank',
    regulator: 'CBN',
    licenceNumber: 'CBN/SYN/CB/2019/014',
    licenceCategory: 'Commercial banking licence (national)',
    licenceStatus: 'active',
    city: 'Lagos',
    state: 'Lagos',
    riskTier: 'high',
    verification: 'verified',
    notes: 'Synthetic tier-2 commercial bank used throughout the demonstration estate.',
    assets: [
      { type: 'internet_banking', name: 'Meridian Retail Internet Banking', identifier: 'ib.meridian.example', ownership: 'verified', evidence: 'Onboarding pack signed by the CBN supervision contact records the channel owner and the operations lead; the documented change ticket references the same origin.', contact: 'Ngozi Adeyemi', contactEmail: 'contact@meridian.example' },
      { type: 'api', name: 'Meridian Open Banking API', identifier: 'api.meridian.example/v1', ownership: 'verified', evidence: 'Partner integration agreement on file names the API gateway operator and the version under support.', contact: 'Partner engineering', contactEmail: 'partners@meridian.example' },
      { type: 'mobile_android', name: 'Meridian Mobile (Android)', identifier: 'com.meridian.synth', ownership: 'candidate', contact: 'Digital channels', contactEmail: 'digital@meridian.example' },
      { type: 'admin_portal', name: 'Meridian Operations Console', identifier: 'ops.meridian.example', ownership: 'candidate', contact: 'Core operations', contactEmail: 'ops@meridian.example' },
    ],
    licenceEvents: [
      { type: 'granted', effectiveAt: '2019-03-11', note: 'National commercial banking licence recorded in the synthetic source list.' },
      { type: 'varied', effectiveAt: '2023-08-01', note: 'Mobile money agent permissions added in the synthetic source list.' },
    ],
    relationships: [{ name: 'Meridian Trust Holdings (synthetic)', relationship: 'parent', note: 'Holding company listed as parent in the synthetic source.' }],
  },
  {
    code: 'KUDI',
    name: 'Kudi Microfinance Bank',
    category: 'microfinance_bank_state',
    regulator: 'CBN',
    licenceNumber: 'CBN/SYN/MFB/2021/087',
    licenceCategory: 'State microfinance bank licence',
    licenceStatus: 'active',
    city: 'Kano',
    state: 'Kano',
    riskTier: 'medium',
    verification: 'verified',
    notes: 'Synthetic state microfinance bank with an agent banking network.',
    assets: [
      { type: 'agent_app', name: 'Kudi Agent App (Android)', identifier: 'com.kudi.agent.synth', ownership: 'verified', evidence: 'Agent operations runbook supplied for this demonstration identifies the mobile team accountable for the application.', contact: 'Sadiq Lawal', contactEmail: 'security@kudi.example' },
      { type: 'onboarding', name: 'Kudi Digital Onboarding', identifier: 'onboard.kudi.example', ownership: 'candidate' },
      { type: 'web_app', name: 'Kudi Marketing Site', identifier: 'kudi.example', ownership: 'candidate' },
    ],
    licenceEvents: [{ type: 'granted', effectiveAt: '2021-06-21', note: 'State microfinance licence in the synthetic source list.' }],
  },
  {
    code: 'PAYFAST',
    name: 'PayFast Payments Ltd',
    category: 'payment_solution_service_provider',
    regulator: 'CBN',
    licenceNumber: 'CBN/SYN/PSP/2020/233',
    licenceCategory: 'Payment solution service provider licence',
    licenceStatus: 'active',
    city: 'Abuja',
    state: 'FCT',
    riskTier: 'high',
    verification: 'provisional',
    stale: true,
    notes: 'Synthetic acquirer. Record imported but not yet re-verified against a current source.',
    assets: [
      { type: 'api', name: 'PayFast Checkout API', identifier: 'api.payfast.example', ownership: 'verified', evidence: 'Merchant technical documentation supplied for the demonstration names the checkout platform owner and the API version.', contact: 'Tolu Bakare', contactEmail: 'compliance@payfast.example' },
      { type: 'webhook', name: 'PayFast Merchant Webhooks', identifier: 'hooks.payfast.example', ownership: 'candidate' },
      { type: 'admin_portal', name: 'PayFast Merchant Console', identifier: 'console.payfast.example', ownership: 'candidate', contact: 'Merchant operations' },
    ],
    licenceEvents: [{ type: 'granted', effectiveAt: '2020-02-17', note: 'PSP licence in the synthetic source list.' }],
  },
  {
    code: 'SYN-NORTHSTAR',
    name: 'Northstar Merchant Bank (synthetic)',
    category: 'merchant_bank',
    regulator: 'CBN',
    licenceNumber: 'CBN/SYN/MB/2022/019',
    licenceCategory: 'Merchant banking licence',
    licenceStatus: 'active',
    city: 'Lagos',
    state: 'Lagos',
    riskTier: 'medium',
    verification: 'provisional',
    notes: 'Invented merchant bank included to exercise the wholesale banking category.',
    assets: [
      { type: 'corporate_banking', name: 'Northstar Corporate Portal', identifier: 'corporate.northstar.invalid', ownership: 'candidate' },
      { type: 'core_banking_interface', name: 'Northstar Core Ledger Interface', identifier: 'core-gw.northstar.invalid', ownership: 'candidate' },
    ],
  },
  {
    code: 'SYN-ALBARAKAH',
    name: 'Al-Barakah Non-Interest Bank (synthetic)',
    category: 'non_interest_bank',
    regulator: 'CBN',
    licenceNumber: 'CBN/SYN/NIB/2021/006',
    licenceCategory: 'Non-interest banking licence',
    licenceStatus: 'active',
    city: 'Kaduna',
    state: 'Kaduna',
    riskTier: 'medium',
    verification: 'unverified',
    notes: 'Invented non-interest bank; licence state not yet reconciled.',
    assets: [{ type: 'mobile_ios', name: 'Al-Barakah Wallet (iOS)', identifier: 'invalid.albarakah.wallet', ownership: 'candidate' }],
  },
  {
    code: 'SYN-MOBILINK',
    name: 'MobiLink Payment Service Bank (synthetic)',
    category: 'payment_service_bank',
    regulator: 'CBN',
    licenceNumber: 'CBN/SYN/PSB/2022/002',
    licenceCategory: 'Payment service bank licence',
    licenceStatus: 'active',
    city: 'Abuja',
    state: 'FCT',
    riskTier: 'high',
    verification: 'provisional',
    notes: 'Invented PSB used to exercise agent-network and mobile money categories.',
    assets: [
      { type: 'mobile_android', name: 'MobiLink Wallet (Android)', identifier: 'invalid.mobilink.wallet', ownership: 'candidate' },
      { type: 'webhook', name: 'MobiLink Agent Settlement Webhook', identifier: 'settle.mobilink.invalid', ownership: 'candidate' },
    ],
  },
  {
    code: 'SYN-SWITCHONE',
    name: 'SwitchOne Processing (synthetic)',
    category: 'switching_and_processing',
    regulator: 'CBN',
    licenceNumber: 'CBN/SYN/SW/2018/004',
    licenceCategory: 'Switching and processing licence',
    licenceStatus: 'active',
    city: 'Lagos',
    state: 'Lagos',
    riskTier: 'critical',
    verification: 'verified',
    notes: 'Synthetic shared switch; the demonstration uses it to show shared infrastructure handling.',
    assets: [
      { type: 'shared_infrastructure', name: 'SwitchOne National Switch (synthetic)', identifier: 'switch.switchone.invalid', ownership: 'rejected', evidence: 'Ownership claim rejected: the demonstration source shows the platform is jointly operated by three institutions, so no single institution may authorise testing alone.' },
      { type: 'api', name: 'SwitchOne Issuer API', identifier: 'issuer.switchone.invalid', ownership: 'candidate' },
    ],
    relationships: [
      { name: 'Three synthetic member institutions', relationship: 'shared_platform', note: 'Shared operation recorded in the synthetic source; each member must authorise separately.' },
    ],
  },
  {
    code: 'SYN-SENTINEL',
    name: 'Sentinel Assurance Plc (synthetic)',
    category: 'insurance_company',
    regulator: 'NAICOM',
    licenceNumber: 'NAICOM/SYN/INS/2017/071',
    licenceCategory: 'General insurance licence',
    licenceStatus: 'active',
    city: 'Lagos',
    state: 'Lagos',
    riskTier: 'low',
    verification: 'provisional',
    notes: 'Invented insurer included to exercise the NAICOM supervised category.',
    assets: [{ type: 'web_app', name: 'Sentinel Customer Portal', identifier: 'portal.sentinel.invalid', ownership: 'candidate' }],
  },
  {
    code: 'SYN-CRESTPEN',
    name: 'Crest Pension Administrators (synthetic)',
    category: 'pension_operator',
    regulator: 'PenCom',
    licenceNumber: 'PENCOM/SYN/PFA/2016/033',
    licenceCategory: 'Pension fund administrator licence',
    licenceStatus: 'suspended',
    city: 'Abuja',
    state: 'FCT',
    riskTier: 'medium',
    verification: 'verified',
    stale: true,
    notes: 'Invented pension administrator with a suspended licence in the synthetic source.',
    assets: [{ type: 'web_app', name: 'Crest Retirement Portal', identifier: 'retire.crest.invalid', ownership: 'candidate' }],
    licenceEvents: [
      { type: 'granted', effectiveAt: '2016-09-05', note: 'PFA licence in the synthetic source.' },
      { type: 'suspended', effectiveAt: '2025-11-02', note: 'Suspension recorded in the synthetic source; no testing may proceed on a suspended institution without supervisory approval.' },
    ],
  },
  {
    code: 'SYN-MERIDIANCORE',
    name: 'CoreBridge Technology Services (synthetic)',
    category: 'third_party_service_provider',
    regulator: 'CBN',
    licenceNumber: 'CBN/SYN/TPP/2021/058',
    licenceCategory: 'Approved third-party technology provider',
    licenceStatus: 'active',
    city: 'Lagos',
    state: 'Lagos',
    riskTier: 'high',
    verification: 'unverified',
    notes: 'Invented outsourced provider. A provider relationship never extends scope to its other clients.',
    assets: [
      { type: 'third_party_service', name: 'CoreBridge Hosted Ledger (synthetic)', identifier: 'ledger.corebridge.invalid', ownership: 'candidate', contact: 'Service desk' },
    ],
    relationships: [
      { name: 'Meridian Trust Bank Plc', relationship: 'outsourced_provider', note: 'Provides hosted ledger services in the synthetic dataset. Testing requires the provider’s own authorisation and the institution’s.' },
    ],
  },
  {
    code: 'SYN-HORIZON',
    name: 'Horizon Securities Ltd (synthetic)',
    category: 'capital_market_operator',
    regulator: 'SEC',
    licenceNumber: 'SEC/SYN/CMO/2019/142',
    licenceCategory: 'Capital market operator registration',
    licenceStatus: 'active',
    city: 'Lagos',
    state: 'Lagos',
    riskTier: 'medium',
    verification: 'provisional',
    notes: 'Invented capital market operator used to exercise the SEC category.',
    assets: [{ type: 'web_app', name: 'Horizon Trading Portal', identifier: 'trade.horizon.invalid', ownership: 'candidate' }],
  },
];

/** Asset types the schema accepts. Anything else is skipped rather than stored. */
const KNOWN_ASSET_TYPES = new Set([
  'web_app', 'internet_banking', 'corporate_banking', 'admin_portal', 'api', 'webhook',
  'mobile_android', 'mobile_ios', 'onboarding', 'core_banking_interface', 'third_party_service', 'shared_infrastructure',
]);

export async function seedRegistry(users: { assessor: SessionUser; reviewer: SessionUser }): Promise<void> {
  console.log('[ficap] seeding synthetic institution and asset registry');

  for (const entry of INSTITUTIONS) {
    await withSystem(async (tx: Tx) => {
      const existing = await tx.queryOne<{ id: string }>('SELECT id FROM institutions WHERE code = $1', [entry.code]);
      const licenceIssued = entry.licenceEvents?.[0]?.effectiveAt ?? '2020-01-01';
      const verifiedAt = entry.stale ? '2024-02-14T09:00:00Z' : new Date(Date.now() - 21 * 86400000).toISOString();

      let institutionId = existing?.id;
      if (institutionId) {
        await tx.query(
          `UPDATE institutions SET regulator = $2, licence_category = $3, licence_status = $4, licence_number = $5,
                  trading_name = $6, verification_status = $7, source_name = $8, source_url = $9,
                  source_retrieved_at = now() - interval '30 days',
                  last_verified_at = $10, registry_notes = $11
            WHERE id = $1`,
          [institutionId, entry.regulator, entry.licenceCategory, entry.licenceStatus, entry.licenceNumber, entry.tradingName ?? null,
            entry.verification, SOURCE, SOURCE_URL, entry.verification === 'unverified' ? null : verifiedAt, entry.notes],
        );
      } else {
        const inserted = await tx.queryOne<{ id: string }>(
          `INSERT INTO institutions (code, name, trading_name, category, regulator, licence_number, licence_category,
              licence_status, licence_issued_at, city, state, risk_tier, status, data_mode, description,
              verification_status, source_name, source_url, source_retrieved_at, last_verified_at, stale_after_days, registry_notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active','demo',$13,$14,$15,$16, now() - interval '30 days', $17,180,$18)
           RETURNING id`,
          [entry.code, entry.name, entry.tradingName ?? null, entry.category, entry.regulator, entry.licenceNumber,
            entry.licenceCategory, entry.licenceStatus, licenceIssued, entry.city, entry.state, entry.riskTier, entry.notes,
            entry.verification, SOURCE, SOURCE_URL, entry.verification === 'unverified' ? null : verifiedAt, entry.notes],
        );
        institutionId = inserted!.id;
      }

      const assetIdByType = new Map<string, string>();
      for (const asset of entry.assets) {
        if (!KNOWN_ASSET_TYPES.has(asset.type)) continue;
        const status = asset.ownership === 'verified' ? 'ownership_verified' : asset.ownership === 'rejected' ? 'ownership_rejected' : 'candidate';
        const row = await tx.queryOne<{ id: string }>(
          `INSERT INTO digital_assets (institution_id, asset_type, display_name, identifier, environment, status, ownership_evidence,
              verified_by, verified_at, technical_contact_name, technical_contact_email, source_name, source_url, retrieved_at,
              notes, data_mode)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now() - interval '30 days', $14,'demo')
           ON CONFLICT (institution_id, asset_type, identifier) DO UPDATE SET display_name = EXCLUDED.display_name
           RETURNING id`,
          [institutionId, asset.type, asset.name, asset.identifier, asset.environment ?? 'production', status,
            asset.evidence ?? null, status === 'candidate' ? null : users.assessor.id, status === 'candidate' ? null : verifiedAt,
            asset.contact ?? null, asset.contactEmail ?? null, SOURCE, SOURCE_URL,
            asset.ownership === 'rejected' ? 'Ownership could not be established for a single institution.' : null],
        );
        if (row) assetIdByType.set(asset.type, row.id);
      }

      for (const event of entry.licenceEvents ?? []) {
        const exists = await tx.queryOne('SELECT id FROM licence_events WHERE institution_id = $1 AND event_type = $2 AND effective_at = $3', [
          institutionId, event.type, event.effectiveAt,
        ]);
        if (exists) continue;
        await tx.query(
          `INSERT INTO licence_events (institution_id, event_type, licence_category, licence_number, effective_at, regulator,
              source_name, source_url, evidence_note, recorded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [institutionId, event.type, entry.licenceCategory, entry.licenceNumber, event.effectiveAt, entry.regulator,
            SOURCE, SOURCE_URL, event.note, users.assessor.id],
        );
      }

      for (const relationship of entry.relationships ?? []) {
        const exists = await tx.queryOne('SELECT id FROM entity_relationships WHERE institution_id = $1 AND related_name = $2', [
          institutionId, relationship.name,
        ]);
        if (exists) continue;
        await tx.query(
          `INSERT INTO entity_relationships (institution_id, related_name, relationship, effective_at, source_name, source_url, notes)
           VALUES ($1,$2,$3,NULL,$4,$5,$6)`,
          [institutionId, relationship.name, relationship.relationship, SOURCE, SOURCE_URL, relationship.note],
        );
      }
    });
  }

  // A few verification-queue items so the reconciliation workflow has content.
  await withSystem(async (tx) => {
    const payfast = await tx.queryOne<any>("SELECT id FROM institutions WHERE code = 'PAYFAST'");
    const altabarakah = await tx.queryOne<any>("SELECT id FROM institutions WHERE code = 'SYN-ALBARAKAH'");
    if (payfast) {
      const existing = await tx.queryOne("SELECT id FROM registry_verification_queue WHERE institution_id = $1 AND item_type = 'stale_record'", [payfast.id]);
      if (!existing) {
        await tx.query(
          `INSERT INTO registry_verification_queue (institution_id, item_type, summary, detail, priority, data_mode)
           VALUES ($1,'stale_record','PayFast record has not been re-verified against a current source','The record was imported as provisional and its verification window has elapsed. Reconcile against the official list before relying on the licence status.','high','demo')`,
          [payfast.id],
        );
      }
    }
    if (altabarakah) {
      const existing = await tx.queryOne("SELECT id FROM registry_verification_queue WHERE institution_id = $1 AND item_type = 'new_record'", [altabarakah.id]);
      if (!existing) {
        await tx.query(
          `INSERT INTO registry_verification_queue (institution_id, item_type, summary, detail, priority, data_mode)
           VALUES ($1,'new_record','Al-Barakah licence state is unverified','The synthetic source lists the institution without a reconciled licence status. Confirm the category and status from the regulator publication before assessment planning.','medium','demo')`,
          [altabarakah.id],
        );
      }
    }
  });

  // One recorded import so the audit history is not empty.
  await withSystem(async (tx) => {
    const existing = await tx.queryOne("SELECT id FROM registry_imports WHERE source_name = $1", [SOURCE]);
    if (existing) return;
    await tx.query(
      `INSERT INTO registry_imports (source_name, source_url, regulator, format, retrieved_at, row_count, created_count,
          updated_count, unchanged_count, conflict_count, rejected_count, status, report, imported_by)
       VALUES ($1,$2,'CBN','json', now() - interval '30 days', $3, $3, 0, 0, 0, 0, 'applied', $4, $5)`,
      [SOURCE, SOURCE_URL, INSTITUTIONS.length, JSON.stringify({ conflicts: [], rejected: [], note: 'Synthetic dataset created for demonstration only.' }), users.reviewer.id],
    );
  });
}

export const REGISTRY_DEMO_SOURCE = SOURCE;
