import { pageContext } from '@/lib/page-context';
import { PageHeader, Card, CardHeader, CardBody, Badge, DataQualityNote } from '@/components/ui';
import { AiAnalystPanel } from '@/components/ai-analyst-panel';

export const dynamic = 'force-dynamic';

export default async function AiAnalystPage() {
  const ctx = await pageContext();
  const hasHfToken = Boolean(process.env.HF_TOKEN);

  return (
    <>
      <PageHeader
        title="AI Security Analyst (Ling-3.0-flash-Fin)"
        description="Streaming financial cybersecurity intelligence powered by Hugging Face InferenceClient and inclusionAI/Ling-3.0-flash-Fin:novita."
        meta={
          <>
            <Badge tone="navy">Ling-3.0-flash-Fin:novita</Badge>
            <Badge tone="green">@huggingface/inference</Badge>
            <Badge tone={hasHfToken ? 'green' : 'amber'}>
              {hasHfToken ? 'Live Inference Active' : 'Offline Engine Fallback'}
            </Badge>
          </>
        }
      />

      <div className="grid gap-4">
        <AiAnalystPanel hasHfToken={hasHfToken} />

        <div className="mt-2">
          <DataQualityNote>
            Central Bank of Nigeria (CBN) supervisory policy strictly fences AI model outputs. Model completions are treated as advisory suggestions requiring human assessor verification before any finding or report inclusion.
          </DataQualityNote>
        </div>
      </div>
    </>
  );
}
