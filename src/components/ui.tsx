import Link from 'next/link';
import type { ReactNode } from 'react';

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

export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-navy-900">{title}</h1>
        {description ? <div className="mt-1 max-w-3xl text-xs leading-relaxed text-[var(--ficap-muted)]">{description}</div> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

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

export function SeverityBadge({ severity, score }: { severity?: string | null; score?: number | null }) {
  const key = (severity ?? 'unscored').toLowerCase();
  const tone: Tone = key === 'critical' ? 'red' : key === 'high' ? 'red' : key === 'medium' ? 'amber' : key === 'low' ? 'green' : key === 'none' ? 'green' : 'neutral';
  const label = key === 'unscored' ? 'unscored' : key;
  return (
    <span className={`badge ${tone === 'red' ? 'badge-red' : tone === 'amber' ? 'badge-amber' : tone === 'green' ? 'badge-green' : 'badge-neutral'}`}>
      {label}
      {score != null ? <span className="font-mono text-[10px] opacity-80">{Number(score).toFixed(1)}</span> : null}
    </span>
  );
}

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
    blocked: 'amber',
    pending: 'slate',
    passed: 'green',
    skipped: 'neutral',
    error: 'red',
    in_review: 'amber',
    changes_requested: 'amber',
    published: 'green',
    superseded: 'neutral',
    active: 'green',
    suspended: 'red',
    assessment_pending: 'amber',
    remediation: 'navy',
    void: 'neutral',
    in_progress: 'navy',
    submitted: 'amber',
    verified: 'green',
    overdue: 'red',
    open: 'slate',
    not_assessed: 'neutral',
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
    pending_official_import: 'amber',
    imported: 'navy',
    expired: 'neutral',
    revoked: 'red',
  };
  const tone = map[status] ?? 'neutral';
  const label = status.replace(/_/g, ' ');
  return <Badge tone={tone}>{label}</Badge>;
}

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
  const border: Record<Tone, string> = {
    neutral: 'border-l-slate-300',
    navy: 'border-l-navy-700',
    green: 'border-l-seal-600',
    amber: 'border-l-amber-500',
    red: 'border-l-risk-critical',
    slate: 'border-l-slate-400',
  };
  const content = (
    <div className={`card border-l-4 ${border[tone]} px-4 py-3 transition-shadow hover:shadow`}>
      <p className="text-2xs font-semibold uppercase tracking-wider text-[var(--ficap-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold leading-none tracking-tight text-navy-900">{value}</p>
      {hint ? <p className="mt-1.5 text-2xs leading-snug text-[var(--ficap-muted)]">{hint}</p> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block focus-visible:rounded-lg">
      {content}
    </Link>
  ) : (
    content
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
      <span className="w-8 shrink-0 text-right font-mono text-2xs text-[var(--ficap-muted)]">{value}</span>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[#d3d8e0] bg-[#fafbfc] px-6 py-10 text-center">
      <p className="text-sm font-semibold text-navy-800">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed text-[var(--ficap-muted)]">{description}</p> : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Flash({ notice, error }: { notice?: string | null; error?: string | null }) {
  if (!notice && !error) return null;
  return (
    <div className="mb-3 space-y-2">
      {error ? (
        <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
          <span className="font-semibold">Action not completed. </span>
          {error}
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          {notice}
        </div>
      ) : null}
    </div>
  );
}

export function TableWrap({ children, maxHeight }: { children: ReactNode; maxHeight?: string }) {
  return (
    <div className="scrollbar-thin overflow-x-auto" style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
      {children}
    </div>
  );
}

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
        {required ? <span className="ml-1 text-risk-critical">*</span> : null}
      </label>
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 text-2xs leading-snug text-[var(--ficap-muted)]">{hint}</p> : null}
    </div>
  );
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="kv">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt>{item.label}</dt>
          <dd>{item.value ?? <span className="text-[var(--ficap-muted)]">not recorded</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DataQualityNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-[#e3e6ec] bg-[#fafbfc] px-3 py-2 text-2xs leading-relaxed text-[var(--ficap-muted)]">
      {children}
    </p>
  );
}

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
    return <p className="px-1 py-2 text-2xs text-[var(--ficap-muted)]">{total} record{total === 1 ? '' : 's'}</p>;
  }
  const link = (target: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
    query.set('page', String(target));
    return `${basePath}?${query.toString()}`;
  };
  return (
    <nav className="flex items-center justify-between gap-3 px-1 py-2 text-2xs text-[var(--ficap-muted)]" aria-label="Pagination">
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

export function ProgressBar({ value, tone = 'navy' }: { value: number; tone?: 'navy' | 'green' | 'amber' | 'red' }) {
  const colors = { navy: 'bg-navy-700', green: 'bg-seal-600', amber: 'bg-amber-500', red: 'bg-risk-critical' };
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${colors[tone]}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-2xs text-[var(--ficap-muted)]">{Math.round(value)}%</span>
    </div>
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
