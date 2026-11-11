import { redirect } from 'next/navigation';
import { pageContext } from '@/lib/page-context';
import {
  AdminDashboard,
  ApproverDashboard,
  AssessorDashboard,
  ContactDashboard,
  ReviewerDashboard,
} from '@/components/dashboards';
import { DashboardPersonaBanner } from '@/components/persona-switcher';

export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const queryRole = typeof params.role === 'string' ? params.role : (typeof params.persona === 'string' ? params.persona : null);
  const ctx = await pageContext();

  if (queryRole && queryRole !== ctx.user.role) {
    redirect(`/api/auth/persona?role=${encodeURIComponent(queryRole)}`);
  }

  const renderDashboard = () => {
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
        return <AssessorDashboard ctx={ctx} />;
    }
  };

  return (
    <>
      <DashboardPersonaBanner currentRole={ctx.user.role} />
      {renderDashboard()}
    </>
  );
}
