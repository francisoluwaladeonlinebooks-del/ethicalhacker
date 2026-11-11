'use client';

import { useActionState, useState } from 'react';
import { loginAction, directPersonaLoginAction, type LoginState } from '@/app/actions/auth';
import { FramedNotice } from '@/components/framed-notice';

type DemoAccount = { email: string; role: string; name: string };

const PERSONA_DETAILS: Record<string, { label: string; dashboard: string; desc: string }> = {
  cbn_assessor: {
    label: 'CBN Assessor',
    dashboard: 'Assessor workspace',
    desc: 'Runs assessments across web, API, mobile and dependency engines; records findings and validates remediation.',
  },
  supervisory_reviewer: {
    label: 'Supervisory Reviewer',
    dashboard: 'Supervisory review',
    desc: 'Reads the cross-institution portfolio, systemic patterns and NIST CSF profiles.',
  },
  report_approver: {
    label: 'Report Approver',
    dashboard: 'Approval queue',
    desc: 'Provides the independent second signature before a supervisory report is issued.',
  },
  institution_contact: {
    label: 'Institution Contact',
    dashboard: 'My institution',
    desc: 'Sees only their own institution, and submits remediation evidence against its findings.',
  },
  platform_admin: {
    label: 'Platform Administrator',
    dashboard: 'Platform operations',
    desc: 'Manages accounts, engine health, catalogue imports and the emergency stop.',
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

export function LoginForm({
  demoAccounts,
  demoPassword,
  demo,
}: {
  demoAccounts: DemoAccount[];
  demoPassword: string;
  /** The shortcut is only offered when the server is actually in demo mode. */
  demo: boolean;
}) {
  const [state, action, pending] = useActionState(loginAction, initialState);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const accountsToDisplay = demo ? (demoAccounts && demoAccounts.length > 0 ? demoAccounts : DEFAULT_DEMO_ACCOUNTS) : [];

  return (
    <div className="space-y-6">
      <FramedNotice />

      <form action={action} className="space-y-4" autoComplete="on">
        {state.error ? (
          <div
            role="alert"
            className="flex gap-2 rounded-sm border border-[#e4bfc9] bg-[#fcf0f3] px-3 py-2 text-xs leading-relaxed text-[#7d1029]"
          >
            <span aria-hidden="true" className="text-[0.6rem] leading-4">
              ▲
            </span>
            <span>{state.error}</span>
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
            className="input mt-1.5"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@cbn.gov.ng"
          />
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <label className="label" htmlFor="password">
              Password
            </label>
            {demoPassword ? (
              <button
                type="button"
                onClick={() => setPassword(demoPassword)}
                className="text-2xs font-semibold text-seal-700 hover:underline"
              >
                Use demonstration password
              </button>
            ) : null}
          </div>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="input mt-1.5"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••••••"
          />
        </div>

        <button type="submit" className="btn btn-primary w-full" disabled={pending}>
          {pending ? 'Verifying credentials…' : 'Continue to authenticator'}
        </button>
        <p className="text-2xs leading-relaxed text-[var(--ficap-ink-muted)]">
          A correct password does not sign you in on its own. The session is only issued after the authenticator code is verified, and
          it expires after a period of inactivity.
        </p>
      </form>

      {demo && accountsToDisplay.length > 0 ? (
        <section className="border-t border-[var(--ficap-border)] pt-5" aria-labelledby="demo-shortcut-heading">
          <div className="flex items-baseline justify-between gap-2">
            <h3 id="demo-shortcut-heading" className="eyebrow">
              Demonstration shortcut
            </h3>
            <span className="badge badge-amber">not available in live mode</span>
          </div>
          <p className="mt-2 text-2xs leading-relaxed text-[var(--ficap-ink-muted)]">
            This build is running on synthetic records. The entries below open a persona without the authenticator step so that each
            workspace can be reviewed quickly. The server refuses them unless <span className="code">FICAP_MODE</span> is{' '}
            <span className="code">demo</span>, and they can only ever assume an account flagged as a demonstration account.
          </p>

          <ul className="mt-3 divide-y divide-[var(--ficap-border)] rounded-sm border border-[var(--ficap-border)]">
            {accountsToDisplay.map((account) => {
              const info = PERSONA_DETAILS[account.role] ?? {
                label: account.role.replace(/_/g, ' '),
                dashboard: 'Workspace',
                desc: 'Supervisory role.',
              };
              return (
                <li key={account.email}>
                  <form action={directPersonaLoginAction}>
                    <input type="hidden" name="persona" value={account.email} />
                    <button
                      type="submit"
                      className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--ficap-surface-sunken)]"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--ficap-border)] bg-[var(--ficap-surface-sunken)] font-display text-xs text-navy-700">
                        {account.name
                          .split(' ')
                          .map((part) => part[0])
                          .join('')
                          .slice(0, 2)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-xs font-semibold text-navy-900">{account.name}</span>
                          <span className="text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-[var(--ficap-ink-faint)]">
                            {info.label}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-[0.625rem] leading-relaxed text-[var(--ficap-ink-muted)]">
                          {info.desc}
                        </span>
                      </span>
                      <span className="shrink-0 text-[0.625rem] font-semibold text-seal-700 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                        Open {info.dashboard} →
                      </span>
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
