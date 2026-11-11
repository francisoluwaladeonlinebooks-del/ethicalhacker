import { switchPersonaAction } from '@/app/actions/auth';

const ALL_PERSONAS = [
  { role: 'cbn_assessor', label: 'Assessor', email: 'assessor@cbn.gov.ng', short: 'Assessor' },
  { role: 'supervisory_reviewer', label: 'Reviewer', email: 'reviewer@cbn.gov.ng', short: 'Reviewer' },
  { role: 'report_approver', label: 'Approver', email: 'approver@cbn.gov.ng', short: 'Approver' },
  { role: 'institution_contact', label: 'Bank Contact', email: 'contact@meridian.example', short: 'Bank' },
  { role: 'platform_admin', label: 'Admin', email: 'admin@cbn.gov.ng', short: 'Admin' },
];

export function TopNavPersonaSwitcher({ currentRole, demo }: { currentRole: string; demo: boolean }) {
  // A role switch that mints a session for another account is a demonstration
  // affordance. Outside demonstration mode the control is not rendered, and the
  // server refuses the request regardless (see switchPersonaAction).
  if (!demo) return null;
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
      <span className="hidden text-[11px] font-semibold text-slate-500 xl:inline">Persona:</span>
      <div className="flex items-center rounded-md border border-slate-200 bg-slate-50/80 p-0.5 shadow-2xs">
        {ALL_PERSONAS.map((p) => {
          const isActive = currentRole === p.role;
          return (
            <form key={p.role} action={switchPersonaAction} className="inline-block">
              <input type="hidden" name="persona" value={p.email} />
              <button
                type="submit"
                title={`Demonstration only: view the platform as ${p.label} (${p.email}) without re-authenticating`}
                className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                  isActive
                    ? 'bg-seal-600 text-white font-bold shadow-2xs'
                    : 'text-slate-600 hover:bg-white hover:text-navy-950'
                }`}
              >
                {p.short}
                {isActive && <span className="ml-1 text-[9px] opacity-90">●</span>}
              </button>
            </form>
          );
        })}
      </div>
    </div>
  );
}

export function SidebarPersonaSwitcher({ currentRole, demo }: { currentRole: string; demo: boolean }) {
  if (!demo) return null;
  return (
    <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
      <p className="text-[10px] uppercase tracking-wider text-navy-300 font-semibold" title="Demonstration builds only">Demo role switch</p>
      <div className="grid grid-cols-2 gap-1">
        {ALL_PERSONAS.map((p) => {
          const isActive = currentRole === p.role;
          return (
            <form key={p.role} action={switchPersonaAction}>
              <input type="hidden" name="persona" value={p.email} />
              <button
                type="submit"
                className={`w-full rounded border px-1.5 py-1 text-left text-[10px] transition ${
                  isActive
                    ? 'border-seal-400 bg-seal-600/30 text-white font-bold'
                    : 'border-white/10 bg-white/5 text-navy-200 hover:bg-white/10 hover:text-white'
                }`}
              >
                <div className="truncate">{p.label}</div>
              </button>
            </form>
          );
        })}
      </div>
    </div>
  );
}
