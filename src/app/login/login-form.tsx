'use client';

import { useActionState, useState } from 'react';
import { loginAction, directPersonaLoginAction, type LoginState } from '@/app/actions/auth';
import { FramedNotice } from '@/components/framed-notice';

type DemoAccount = { email: string; role: string; name: string };

const PERSONA_DETAILS: Record<string, { badge: string; dashboard: string; tone: string; desc: string }> = {
  cbn_assessor: {
    badge: 'CBN Assessor',
    dashboard: 'Assessor Workspace',
    tone: 'bg-blue-100 text-blue-800 border-blue-200',
    desc: 'Conducts assessments across web, API, mobile & dependencies, logs findings & validates remediation.',
  },
  supervisory_reviewer: {
    badge: 'Supervisory Reviewer',
    dashboard: 'Supervisory Review',
    tone: 'bg-purple-100 text-purple-800 border-purple-200',
    desc: 'Analyzes cross-institution portfolios, systemic risk patterns, and NIST CSF profiles.',
  },
  report_approver: {
    badge: 'Report Approver',
    dashboard: 'Report Approval Queue',
    tone: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    desc: 'Enforces six-eyes principle: reviews, requests changes, and signs off supervisory audit reports.',
  },
  institution_contact: {
    badge: 'Bank Contact',
    dashboard: 'My Institution Portal',
    tone: 'bg-amber-100 text-amber-800 border-amber-200',
    desc: 'Meridian Trust Bank contact: reviews findings scoped to their bank and submits remediation evidence.',
  },
  platform_admin: {
    badge: 'Platform Admin',
    dashboard: 'Platform Operations',
    tone: 'bg-slate-200 text-slate-800 border-slate-300',
    desc: 'Manages user accounts, engine health, framework catalogues, and emergency stop controls.',
  },
};

const DEFAULT_DEMO_ACCOUNTS: DemoAccount[] = [
  { email: 'assessor@cbn.gov.ng', role: 'cbn_assessor', name: 'Chinedu Okafor' },
  { email: 'reviewer@cbn.gov.ng', role: 'supervisory_reviewer', name: 'Fatima Yusuf' },
  { email: 'approver@cbn.gov.ng', role: 'report_approver', name: 'Ibrahim Sani' },
  { email: 'contact@meridian.example', role: 'institution_contact', name: 'Ngozi Adeyemi' },
  { email: 'admin@cbn.gov.ng', role: 'platform_admin', name: 'Amina Bello' },
];

const initialState: LoginState = {};

export function LoginForm({ demoAccounts, demoPassword }: { demoAccounts: DemoAccount[]; demoPassword: string }) {
  const [state, action, pending] = useActionState(loginAction, initialState);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const accountsToDisplay = demoAccounts && demoAccounts.length > 0 ? demoAccounts : DEFAULT_DEMO_ACCOUNTS;

  return (
    <div className="space-y-6">
      <FramedNotice />

      <div className="rounded-lg border-2 border-seal-600/40 bg-gradient-to-b from-seal-50/50 to-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-navy-950">
            ⚡ Instant 1-Click Persona Sign-In
          </h3>
          <span className="rounded bg-seal-600/10 px-1.5 py-0.5 text-[10px] font-semibold text-seal-800">
            Direct Access
          </span>
        </div>
        <p className="mt-1 text-2xs leading-relaxed text-[var(--ficap-muted)]">
          Select any persona below to authenticate instantly and land directly on that persona&apos;s specialised dashboard:
        </p>

        <div className="mt-3 space-y-2">
          {accountsToDisplay.map((account) => {
              const info = PERSONA_DETAILS[account.role] ?? {
                badge: account.role.replace(/_/g, ' '),
                dashboard: 'Role Dashboard',
                tone: 'bg-slate-100 text-slate-700 border-slate-200',
                desc: 'Specialized supervisory role.',
              };

              return (
                <form key={account.email} action={directPersonaLoginAction} className="block">
                  <input type="hidden" name="persona" value={account.email} />
                  <button
                    type="submit"
                    className="group flex w-full flex-col gap-1 rounded-md border border-slate-200 bg-white p-2.5 text-left transition hover:border-seal-600 hover:bg-seal-50/30 hover:shadow-sm"
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className="text-xs font-bold text-navy-900 group-hover:text-seal-800">
                          {account.name}
                        </span>
                        <span className={`inline-block rounded border px-1.5 py-0.2 text-[10px] font-semibold ${info.tone}`}>
                          {info.badge}
                        </span>
                      </span>
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-seal-700 group-hover:underline">
                        Open {info.dashboard} →
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-snug">
                      {info.desc}
                    </p>
                    <span className="font-mono text-[10px] text-slate-600">
                      {account.email}
                    </span>
                  </button>
                </form>
              );
            })}
          </div>
        </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200" />
        </div>
        <div className="relative flex justify-center text-2xs uppercase">
          <span className="bg-[var(--ficap-bg)] px-2 text-slate-600">
            Or sign in with email and password
          </span>
        </div>
      </div>

      <form action={action} className="space-y-3" autoComplete="on">
        {state.error ? (
          <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
            {state.error}
          </div>
        ) : null}
        <div>
          <label className="label" htmlFor="email">
            Official email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="username"
            className="input mt-1"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="assessor@cbn.gov.ng"
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="label" htmlFor="password">
              Password
            </label>
            {demoPassword ? (
              <button
                type="button"
                onClick={() => setPassword(demoPassword)}
                className="text-[10px] text-seal-700 hover:underline"
              >
                Use demo password
              </button>
            ) : null}
          </div>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="input mt-1"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••••••"
          />
        </div>
        <button type="submit" className="btn btn-secondary w-full py-2 text-sm" disabled={pending}>
          {pending ? 'Verifying credentials…' : 'Sign in with credentials'}
        </button>
      </form>
    </div>
  );
}
