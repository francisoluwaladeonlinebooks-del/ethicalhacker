import { switchPersonaAction } from '@/app/actions/auth';

const ALL_PERSONAS = [
  { role: 'cbn_assessor', label: 'Assessor', email: 'assessor@cbn.gov.ng', short: 'Assessor' },
  { role: 'supervisory_reviewer', label: 'Reviewer', email: 'reviewer@cbn.gov.ng', short: 'Reviewer' },
  { role: 'report_approver', label: 'Approver', email: 'approver@cbn.gov.ng', short: 'Approver' },
  { role: 'institution_contact', label: 'Bank Contact', email: 'contact@meridian.example', short: 'Bank' },
  { role: 'platform_admin', label: 'Admin', email: 'admin@cbn.gov.ng', short: 'Admin' },
];

export function TopNavPersonaSwitcher({ currentRole }: { currentRole: string }) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
      <span className="hidden text-[11px] font-semibold text-slate-500 xl:inline">Persona:</span>
      <div className="flex items-center rounded-md border border-slate-200 bg-slate-50/80 p-0.5 shadow-2xs">
        {ALL_PERSONAS.map((p) => {
          const isActive = currentRole === p.role;
          return (
            <a
              key={p.role}
              href={`/api/auth/persona?email=${encodeURIComponent(p.email)}`}
              title={`Switch persona to ${p.label} (${p.email})`}
              className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                isActive
                  ? 'bg-seal-600 text-white font-bold shadow-2xs'
                  : 'text-slate-600 hover:bg-white hover:text-navy-950'
              }`}
            >
              {p.short}
              {isActive && <span className="ml-1 text-[9px] opacity-90">●</span>}
            </a>
          );
        })}
      </div>
    </div>
  );
}

export function SidebarPersonaSwitcher({ currentRole }: { currentRole: string }) {
  return (
    <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
      <p className="text-[10px] uppercase tracking-wider text-navy-300 font-semibold">Switch Persona</p>
      <div className="grid grid-cols-2 gap-1">
        {ALL_PERSONAS.map((p) => {
          const isActive = currentRole === p.role;
          return (
            <a
              key={p.role}
              href={`/api/auth/persona?email=${encodeURIComponent(p.email)}`}
              className={`w-full rounded border px-1.5 py-1 text-left text-[10px] transition ${
                isActive
                  ? 'border-seal-400 bg-seal-600/30 text-white font-bold'
                  : 'border-white/10 bg-white/5 text-navy-200 hover:bg-white/10 hover:text-white'
              }`}
            >
              <div className="truncate">{p.label}</div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

export function DashboardPersonaBanner({ currentRole }: { currentRole: string }) {
  return (
    <div className="mb-6 rounded-lg border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 p-3 shadow-2xs">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-seal-800">
            Direct Persona Workspace Navigation
          </span>
          <p className="text-xs text-slate-600">
            Click any persona below to switch directly to their role-specific dashboard with zero authentication gates:
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-2xs text-slate-500">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          Active: <strong className="text-navy-950 font-semibold">{currentRole.replace(/_/g, ' ')}</strong>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {ALL_PERSONAS.map((p) => {
          const isActive = currentRole === p.role;
          return (
            <a
              key={p.role}
              href={`/api/auth/persona?email=${encodeURIComponent(p.email)}`}
              className={`flex flex-col justify-between rounded-md border p-2 text-left transition ${
                isActive
                  ? 'border-seal-600 bg-seal-50/80 shadow-xs ring-1 ring-seal-600'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className={`text-xs font-bold ${isActive ? 'text-seal-900' : 'text-slate-800'}`}>
                  {p.label}
                </span>
                {isActive ? (
                  <span className="rounded bg-seal-600 px-1 py-0.2 text-[9px] font-bold text-white">Active</span>
                ) : (
                  <span className="text-[10px] text-slate-400 group-hover:text-slate-600">Switch →</span>
                )}
              </div>
              <span className="mt-1 font-mono text-[10px] text-slate-500 truncate">{p.email}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
