import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <p className="text-2xs font-semibold uppercase tracking-wider text-[var(--ficap-muted)]">404</p>
      <h1 className="mt-2 text-lg font-semibold text-navy-900">Record not found</h1>
      <p className="mt-2 text-xs leading-relaxed text-[var(--ficap-muted)]">
        The record does not exist, or it is outside the institutions and engagements you are authorised to see. Both cases are answered the same way so the
        existence of a record cannot be probed.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <Link href="/" className="btn btn-primary">Overview</Link>
        <Link href="/findings" className="btn btn-secondary">Findings</Link>
      </div>
    </div>
  );
}
