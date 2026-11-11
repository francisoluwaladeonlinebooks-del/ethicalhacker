import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * FICAP primitives.
 *
 * These are the only components that know the design language; every screen
 * composes them. Rules encoded here rather than in each page:
 *
 *  - a page title is display serif, with an optional italic second clause;
 *  - a section is introduced by a numbered marker (design.md §6.1);
 *  - severity carries a glyph and a word, never colour alone (§7);
 *  - "not measured" is a distinct, neutral, dashed state (§7.5);
 *  - the destructive button is a different shape from every other button (§6.2).
 */

/* -------------------------------------------------------------------------- */
/* Structure                                                                   */
/* -------------------------------------------------------------------------- */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function CardHeader({
  title,
  subtitle,
  actions,
  id,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <header className="card-header" id={id}>
      <div className="min-w-0">
        <h2 className="card-title">{title}</h2>
        {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card-body ${className}`}>{children}</div>;
}

/** The reference's `01 —— LABEL` orientation device. */
export function SectionMarker({
  index,
  label,
  onField = false,
  className = '',
}: {
  index?: string | number;
  label: string;
  onField?: boolean;
  className?: string;
}) {
  return (
    <div className={`section-marker ${onField ? 'on-field' : ''} ${className}`}>
      {index !== undefined ? <span className="marker-index">{String(index).padStart(2, '0')}</span> : null}
      <span className="marker-rule" aria-hidden="true" />
      <span className="marker-label">{label}</span>
    </div>
  );
}

/**
 * Page header. `accent` renders the reference's italic second clause; it is
 * display type and must never carry a finding, a score or a status.
 */
export function PageHeader({
  title,
  accent,
  description,
  actions,
  meta,
  eyebrow,
  index,
  scale = 'md',
}: {
  title: string;
  accent?: string;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  eyebrow?: string;
  index?: string | number;
  scale?: 'md' | 'lg';
}) {
  return (
    <div className="mb-6">
      {eyebrow ? <SectionMarker index={index} label={eyebrow} className="mb-3" /> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className={scale === 'lg' ? 'display-lg text-navy-900' : 'display-md text-navy-900'}>
            {title}
            {accent ? (
              <>
                {' '}
                <span className="display-italic text-seal-700">{accent}</span>
              </>
            ) : null}
          </h1>
          {description ? (
            <div className="mt-2 max-w-prose text-[0.8125rem] leading-relaxed text-[var(--ficap-ink-muted)]">{description}</div>
          ) : null}
          {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Severity and status                                                         */
/* -------------------------------------------------------------------------- */

type Tone = 'neutral' | 'navy' | 'green' | 'amber' | 'red' | 'slate';

export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: Tone; title?: string }) {
  const map: Record<Tone, string> = {
    neutral: 'badge-neutral',
    navy: 'badge-navy',
    green: 'badge-green',
    amber: 'badge-amber',
    red: 'badge-red',
    slate: 'badge-slate',
  };
  return (
    <span className={`badge ${map[tone]}`} title={title}>
      {children}
    </span>
  );
}

/** Glyph per level — the redundant channel that survives colour loss. */
const SEVERITY_GLYPH: Record<string, string> = {
  critical: '◆',
  high: '▲',
  medium: '●',
  low: '■',
  info: '○',
  none: '○',
  unscored: '◇',
};

const SEVERITY_CLASS: Record<string, string> = {
  critical: 'badge-red',
  high: 'badge-red',
  medium: 'badge-amber',
  low: 'badge-green',
  info: 'badge-neutral',
  none: 'badge-green',
  unscored: 'badge-unassessed',
};

/**
 * Severity badge. Colour, glyph, word and (for unscored) border style are all
 * present, so the level is legible in greyscale, in forced-colours mode and to
 * a screen reader. `unscored` is not a synonym for `low`.
 */
export function SeverityBadge({ severity, score }: { severity?: string | null; score?: number | null }) {
  const key = (severity ?? 'unscored').toLowerCase();
  const cls = SEVERITY_CLASS[key] ?? 'badge-unassessed';
  const label = key === 'unscored' ? 'unscored' : key;
  return (
    <span className={`badge ${cls}`} title={severity ? `Severity: ${label}` : 'No severity score recorded'}>
      <span aria-hidden="true" className="text-[0.6rem] leading-none">
        {SEVERITY_GLYPH[key] ?? '◇'}
      </span>
      <span>{label}</span>
      {score != null ? <span className="font-mono text-[10px] opacity-80">{Number(score).toFixed(1)}</span> : null}
    </span>
  );
}

/** States that mean "we could not measure this" — never green, never red. */
const UNMEASURED = new Set([
  'not_assessed',
  'blocked',
  'skipped',
  'untested',
  'unavailable',
  'pending_official_import',
  'not_available',
]);

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, Tone> = {
    new: 'slate',
    needs_verification: 'amber',
    confirmed: 'red',
    false_positive: 'neutral',
    accepted_risk: 'amber',
    remediation_in_progress: 'navy',
    ready_for_retest: 'navy',
    resolved: 'green',
    reopened: 'red',
    closed: 'neutral',
    draft: 'slate',
    pending_authorization: 'amber',
    authorized: 'navy',
    plan_review: 'amber',
    approved: 'navy',
    running: 'navy',
    paused: 'amber',
    stopped: 'red',
    completed: 'green',
    cancelled: 'neutral',
    queued: 'slate',
    cancelling: 'amber',
    succeeded: 'green',
    failed: 'red',
    pending: 'slate',
    passed: 'green',
    error: 'red',
    in_review: 'amber',
    changes_requested: 'amber',
    published: 'green',
    superseded: 'neutral',
    active: 'green',
    suspended: 'red',
    assessment_pending: 'amber',
    void: 'neutral',
    in_progress: 'navy',
    submitted: 'amber',
    verified: 'green',
    overdue: 'red',
    open: 'slate',
    evidence_required: 'amber',
    partially_supported: 'navy',
    supported: 'green',
    improvement_required: 'red',
    not_applicable: 'neutral',
    requested: 'slate',
    inconclusive: 'amber',
    not_resolved: 'red',
    partial: 'amber',
    requested_review: 'amber',
    suggested: 'amber',
    accepted: 'green',
    rejected: 'neutral',
    in_progress_review: 'navy',
    enabled: 'green',
    disabled: 'neutral',
    degraded: 'amber',
    seeded: 'slate',
    imported: 'navy',
    expired: 'neutral',
    revoked: 'red',
  };
  const tone = map[status] ?? 'neutral';
  const label = status.replace(/_/g, ' ');

  if (UNMEASURED.has(status)) {
    return (
      <span className="badge badge-unassessed" title="This item was not measured. It is not a pass and not a failure.">
        <span aria-hidden="true" className="text-[0.55rem] leading-none">
          ◇
        </span>
        {label}
      </span>
    );
  }

  const dot: Record<Tone, string> = {
    neutral: 'bg-slate-400',
    navy: 'bg-navy-600',
    green: 'bg-seal-600',
    amber: 'bg-amber-500',
    red: 'bg-risk-critical',
    slate: 'bg-slate-500',
  };
  return (
    <span className={`badge badge-${tone}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot[tone]}`} />
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Metrics                                                                     */
/* -------------------------------------------------------------------------- */

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  href?: string;
}) {
  const mark: Record<Tone, string> = {
    neutral: 'text-slate-300',
    navy: 'text-navy-300',
    green: 'text-seal-500',
    amber: 'text-amber-500',
    red: 'text-risk-critical',
    slate: 'text-slate-400',
  };
  const content = (
    <div className="card group px-4 py-3.5 transition-colors hover:border-[var(--ficap-border-strong)]">
      <div className="flex items-start justify-between gap-2">
        <p className="eyebrow">{label}</p>
        <span aria-hidden="true" className={`text-[0.5rem] leading-none ${mark[tone]}`}>
          ●
        </span>
      </div>
      <p className="mt-2 font-display text-[1.75rem] font-medium leading-none tracking-tight text-navy-900">{value}</p>
      {hint ? <p className="mt-2 text-2xs leading-snug text-[var(--ficap-ink-muted)]">{hint}</p> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-md">
      {content}
    </Link>
  ) : (
    content
  );
}

/**
 * The reference's capsule stat rail: icon · numeral · caption, hairline divided.
 * Used only on the navy field, at most four figures per band. Every figure is
 * expected to carry its own qualification in `note`.
 */
export function StatRail({
  items,
  className = '',
}: {
  items: { label: string; value: ReactNode; note?: string; icon?: ReactNode }[];
  className?: string;
}) {
  return (
    <dl
      className={`flex flex-wrap items-stretch divide-y divide-white/10 rounded-lg border border-white/10 sm:flex-nowrap sm:divide-x sm:divide-y-0 ${className}`}
    >
      {items.map((item) => (
        <div key={item.label} className="flex flex-1 items-center gap-3 px-4 py-3">
          {item.icon ? (
            <span aria-hidden="true" className="text-white/40">
              {item.icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <dd className="font-display text-lg font-medium leading-none text-white">{item.value}</dd>
            <dt className="mt-1 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-navy-200">{item.label}</dt>
            {item.note ? <p className="mt-0.5 text-[0.6rem] text-navy-300">{item.note}</p> : null}
          </div>
        </div>
      ))}
    </dl>
  );
}

export function Bar({
  value,
  max,
  tone = 'navy',
  label,
}: {
  value: number;
  max: number;
  tone?: 'navy' | 'red' | 'amber' | 'green' | 'slate';
  label?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const colors: Record<string, string> = {
    navy: 'bg-navy-700',
    red: 'bg-risk-critical',
    amber: 'bg-amber-500',
    green: 'bg-seal-600',
    slate: 'bg-slate-400',
  };
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-full min-w-[40px] overflow-hidden rounded-full bg-slate-100" role="img" aria-label={label ?? `${value} of ${max}`}>
        <div className={`h-full rounded-full ${colors[tone]}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right font-mono text-2xs text-[var(--ficap-ink-muted)]">{value}</span>
    </div>
  );
}

export function ProgressBar({ value, tone = 'navy' }: { value: number; tone?: 'navy' | 'green' | 'amber' | 'red' }) {
  const colors = { navy: 'bg-navy-700', green: 'bg-seal-600', amber: 'bg-amber-500', red: 'bg-risk-critical' };
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${colors[tone]}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-2xs text-[var(--ficap-ink-muted)]">{Math.round(value)}%</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                    */
/* -------------------------------------------------------------------------- */

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-[var(--ficap-border-strong)] bg-[var(--ficap-surface-sunken)] px-6 py-12 text-center">
      <p className="display-md text-navy-900">{title}</p>
      {description ? (
        <p className="mx-auto mt-2 max-w-prose text-xs leading-relaxed text-[var(--ficap-ink-muted)]">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Flash({ notice, error }: { notice?: string | null; error?: string | null }) {
  if (!notice && !error) return null;
  return (
    <div className="mb-3 space-y-2">
      {error ? (
        <div role="alert" className="flex gap-2 rounded-sm border border-[#e4bfc9] bg-[#fcf0f3] px-3 py-2 text-xs leading-relaxed text-[#7d1029]">
          <span aria-hidden="true" className="text-[0.6rem] leading-4">
            ▲
          </span>
          <span>
            <span className="font-semibold">Action not completed. </span>
            {error}
          </span>
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="flex gap-2 rounded-sm border border-[#b9ddd6] bg-[#ecf7f4] px-3 py-2 text-xs leading-relaxed text-[#0a5b52]">
          <span aria-hidden="true" className="text-[0.6rem] leading-4">
            ✓
          </span>
          <span>{notice}</span>
        </div>
      ) : null}
    </div>
  );
}

export function TableWrap({ children, maxHeight, label }: { children: ReactNode; maxHeight?: string; label?: string }) {
  return (
    <div
      className="scrollbar-thin overflow-x-auto"
      style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}
      role="region"
      aria-label={label ?? 'Scrollable data table'}
      tabIndex={0}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Forms and data                                                              */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  name,
  children,
  hint,
  required,
  span,
}: {
  label: string;
  name?: string;
  children: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  span?: 1 | 2 | 3 | 4 | 6;
}) {
  const spanClass = span ? `sm:col-span-${span}` : '';
  return (
    <div className={spanClass}>
      <label className="label" htmlFor={name}>
        {label}
        {required ? (
          <span className="ml-1 text-risk-critical" aria-hidden="true">
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="mt-1.5 text-2xs leading-snug text-[var(--ficap-ink-muted)]">{hint}</p> : null}
    </div>
  );
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="kv">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt>{item.label}</dt>
          <dd>{item.value ?? <span className="text-[var(--ficap-ink-muted)]">not recorded</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DataQualityNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 rounded-sm border border-[var(--ficap-border)] bg-[var(--ficap-surface-sunken)] px-3 py-2 text-2xs leading-relaxed text-[var(--ficap-ink-muted)]">
      <span aria-hidden="true" className="text-[0.6rem] leading-4 text-[var(--ficap-ink-faint)]">
        ◇
      </span>
      <span>{children}</span>
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

export function formatDate(value: string | Date | null | undefined, withTime = false): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  const iso = date.toISOString();
  return withTime ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z` : iso.slice(0, 10);
}

export function relativeDays(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const diff = Math.round((date.getTime() - Date.now()) / 86400000);
  if (diff === 0) return 'today';
  if (diff > 0) return `in ${diff}d`;
  return `${Math.abs(diff)}d ago`;
}

export function Pagination({
  basePath,
  page,
  pageSize,
  total,
  params = {},
}: {
  basePath: string;
  page: number;
  pageSize: number;
  total: number;
  params?: Record<string, string | undefined>;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) {
    return <p className="px-1 py-2 text-2xs text-[var(--ficap-ink-muted)]">{total} record{total === 1 ? '' : 's'}</p>;
  }
  const link = (target: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
    query.set('page', String(target));
    return `${basePath}?${query.toString()}`;
  };
  return (
    <nav className="flex items-center justify-between gap-3 px-1 py-2 text-2xs text-[var(--ficap-ink-muted)]" aria-label="Pagination">
      <span>
        Showing {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}
      </span>
      <div className="flex items-center gap-1">
        <Link href={link(Math.max(1, page - 1))} aria-disabled={page <= 1} className={`btn btn-secondary btn-xs ${page <= 1 ? 'pointer-events-none opacity-40' : ''}`}>
          Previous
        </Link>
        <span className="px-2">
          Page {page} of {lastPage}
        </span>
        <Link href={link(Math.min(lastPage, page + 1))} aria-disabled={page >= lastPage} className={`btn btn-secondary btn-xs ${page >= lastPage ? 'pointer-events-none opacity-40' : ''}`}>
          Next
        </Link>
      </div>
    </nav>
  );
}

export const SEVERITY_TONE: Record<string, 'red' | 'amber' | 'green' | 'neutral'> = {
  critical: 'red',
  high: 'red',
  medium: 'amber',
  low: 'green',
  none: 'green',
  unscored: 'neutral',
};
