import { pageContext } from '@/lib/page-context';
import {
  AdminDashboard,
  ApproverDashboard,
  AssessorDashboard,
  ContactDashboard,
  ReviewerDashboard,
} from '@/components/dashboards';

export const dynamic = 'force-dynamic';

/**
 * Landing page dispatcher.
 *
 * Five roles, five different jobs: an assessor works a queue of engagements, a
 * reviewer works a portfolio, an approver works a report queue, an institution
 * contact answers findings raised against them, and an administrator keeps the
 * platform running. Showing all of them the same executive summary made four of
 * the five read a dashboard built for somebody else.
 *
 * The dashboard is chosen from the authenticated role, which is resolved
 * server-side from the session. A user cannot reach another role's dashboard by
 * navigating, and each loader re-checks the role before it queries anything.
 */
export default async function HomePage() {
  const ctx = await pageContext();

  switch (ctx.user.role) {
    case 'cbn_assessor':
      return <AssessorDashboard ctx={ctx} />;
    case 'supervisory_reviewer':
      return <ReviewerDashboard ctx={ctx} />;
    case 'report_approver':
      return <ApproverDashboard ctx={ctx} />;
    case 'institution_contact':
      return <ContactDashboard ctx={ctx} />;
    case 'platform_admin':
      return <AdminDashboard ctx={ctx} />;
    default:
      // An unrecognised role holds no permissions; the navigation renders an
      // empty shell rather than an empty dashboard pretending to have data.
      return (
        <div className="card p-6">
          <h1 className="text-lg font-semibold tracking-tight text-navy-900">No workspace is assigned to this account</h1>
          <p className="mt-1 text-xs text-[var(--ficap-muted)]">
            Your account does not hold a recognised supervisory role. Contact the platform administrator.
          </p>
        </div>
      );
  }
}
