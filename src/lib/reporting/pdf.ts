import PDFDocument from 'pdfkit';
import { toSafeText } from '@/lib/reporting/report';

/**
 * Deterministic PDF rendering from a stored report snapshot.
 * Only ASCII-safe text is emitted so the built-in Helvetica font is valid.
 * No evidence bodies are rendered - only the manifest (hashes, sizes).
 */

type Snapshot = any;

const NAVY = '#12224a';
const SLATE = '#44506b';
const MUTED = '#6d778c';
const LINE = '#d5d9e2';
const RED = '#a4262c';
const AMBER = '#8a6100';

export function renderReportPdf(snapshot: Snapshot): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: toSafeText(snapshot.title), Author: 'FICAP', Subject: 'Cybersecurity assessment report' } });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width - 96;
      const footer = () => {
        const range = doc.bufferedPageRange();
        for (let i = 0; i < range.count; i += 1) {
          doc.switchToPage(range.start + i);
          const y = doc.page.height - 38;
          doc.font('Helvetica').fontSize(7).fillColor(MUTED);
          doc.text(
            toSafeText(
              `${snapshot.dataMode === 'demo' ? 'DEMO DATA - NOT A LIVE REGULATORY RECORD  |  ' : ''}${confidentiality(snapshot)}  |  ${snapshot.title}`,
            ),
            48,
            y,
            { width: pageWidth * 0.72, lineBreak: false },
          );
          doc.text(`Page ${i + 1} of ${range.count}`, 48 + pageWidth * 0.72, y, { width: pageWidth * 0.28, align: 'right', lineBreak: false });
        }
      };

      // Cover
      doc.rect(0, 0, doc.page.width, 12).fill(snapshot.dataMode === 'demo' ? AMBER : NAVY);
      doc.moveDown(5);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('CENTRAL BANK OF NIGERIA');
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(20).fillColor(NAVY).text('Financial Institution Cybersecurity Assurance Platform', { width: pageWidth });
      doc.moveDown(1.6);
      doc.font('Helvetica-Bold').fontSize(16).fillColor(NAVY).text(toSafeText(snapshot.title), { width: pageWidth });
      doc.moveDown(0.4);
      doc.font('Helvetica').fontSize(10).fillColor(SLATE).text(`Report type: ${labelFor(snapshot.reportType)}`, { width: pageWidth });
      doc.text(`Generated: ${new Date(snapshot.generatedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC`, { width: pageWidth });
      if (snapshot.institution) {
        doc.text(`Institution: ${toSafeText(snapshot.institution.name)} (${snapshot.institution.code})`, { width: pageWidth });
        doc.text(`Category: ${categoryLabel(snapshot.institution.category)}  |  Risk tier: ${snapshot.institution.riskTier}`, { width: pageWidth });
      }
      if (snapshot.engagement) {
        doc.text(`Engagement: ${snapshot.engagement.code} - ${toSafeText(snapshot.engagement.name)}`, { width: pageWidth });
        doc.text(`Authorisation reference: ${toSafeText(snapshot.engagement.authorizationRef ?? 'not recorded')}`, { width: pageWidth });
        doc.text(
          `Scope validity: ${fmtDate(snapshot.engagement.scopeApprovedAt)} to ${fmtDate(snapshot.engagement.scopeExpiresAt)}`,
          { width: pageWidth },
        );
      }
      if (snapshot.period?.start || snapshot.period?.end) {
        doc.text(`Reporting period: ${snapshot.period.start ?? 'start'} to ${snapshot.period.end ?? 'present'}`, { width: pageWidth });
      }

      if (snapshot.dataMode === 'demo') {
        doc.moveDown(1.4);
        doc.roundedRect(48, doc.y, pageWidth, 46, 4).fillAndStroke('#fdf3d0', '#e2c56a');
        doc.fillColor(AMBER).font('Helvetica-Bold').fontSize(10).text('DEMONSTRATION DATA', 60, doc.y + 12, { width: pageWidth - 24 });
        doc.font('Helvetica').fontSize(8.5).fillColor(SLATE).text(
          'This report is generated from synthetic demonstration records. It is not a regulatory finding and must not be relied upon as an assessment of any licensed institution.',
          60,
          doc.y + 13,
          { width: pageWidth - 24 },
        );
        doc.y += 20;
      }

      section(doc, 'Scope of reporting');
      body(
        doc,
        'This report is produced only from authorised, non-destructive assessment activity recorded inside the engagement scope. Findings are classified as confirmed (independently verified), suspected (recorded but not verified), observation (advisory or not scored) or not assessed. Checks that could not be executed are reported as blocked or not assessed and are never presented as passes.',
      );
      if (snapshot.limitations?.length) {
        bulletList(doc, snapshot.limitations);
      }

      // Summary
      section(doc, 'Summary');
      const s = snapshot.summary ?? {};
      keyValues(doc, [
        ['Findings recorded', String(s.totalFindings ?? 0)],
        ['Open findings', String(s.openFindings ?? 0)],
        ['Confirmed (independently verified)', String(s.confirmed ?? 0)],
        ['Suspected (not yet verified)', String(s.suspected ?? 0)],
        ['Observations', String(s.observation ?? 0)],
        ['Highest technical severity', String(s.highestSeverity ?? 'none').toUpperCase()],
        ['Checks blocked', String(s.blockedChecks ?? 0)],
        ['Checks not assessed', String(s.notAssessedChecks ?? 0)],
        ['Remediation verified', String(s.verifiedRemediation ?? 0)],
        ['Remediation overdue', String(s.overdueRemediation ?? 0)],
      ]);

      if (snapshot.reportType === 'supervisory_portfolio' && snapshot.portfolio?.length) {
        section(doc, 'Portfolio position');
        table(
          doc,
          ['Institution', 'Category', 'Open', 'Critical/High', 'Unverified', 'Overdue'],
          snapshot.portfolio.map((row: any) => [
            toSafeText(row.name),
            categoryLabel(row.category),
            String(row.open_findings ?? 0),
            String(row.critical_high ?? 0),
            String(row.unverified ?? 0),
            row.worst_overdue ?? '-',
          ]),
          [0.36, 0.22, 0.1, 0.14, 0.1, 0.08],
        );
        body(
          doc,
          'Portfolio figures are aggregated for supervisory planning only. They do not constitute a supervisory rating of any institution, and no institution-level evidence is disclosed across institutions in this report.',
        );
      }

      // Confirmed and suspected findings
      const findings: any[] = snapshot.findings ?? [];
      const groups: { key: string; title: string; rows: any[] }[] = [
        { key: 'confirmed', title: 'Confirmed findings (independently verified)', rows: findings.filter((f) => f.classification === 'confirmed') },
        { key: 'suspected', title: 'Suspected findings (verification outstanding)', rows: findings.filter((f) => f.classification === 'suspected') },
        { key: 'observation', title: 'Observations and advisory items', rows: findings.filter((f) => f.classification === 'observation') },
      ];

      for (const group of groups) {
        if (!group.rows.length) continue;
        doc.addPage();
        section(doc, group.title);
        if (group.key === 'suspected') {
          body(
            doc,
            'The items below have not completed independent verification. They are reported as suspected and must not be treated as confirmed deficiencies until verified.',
          );
        }
        if (group.key === 'observation') {
          body(doc, 'Advisory items carry no confirmed control failure. They are recorded to support improvement and are excluded from confirmed risk counts.');
        }
        for (const finding of group.rows) {
          findingBlock(doc, finding);
        }
      }

      // Coverage
      doc.addPage();
      section(doc, 'Testing coverage by framework');
      body(
        doc,
        'Coverage is reported exactly as executed. "Blocked" means the check could not be completed because a prerequisite or target capability was unavailable; "not assessed" means it was not executed. Neither is evidence that the control is effective.',
      );
      if (snapshot.coverage?.length) {
        table(
          doc,
          ['Framework', 'Version', 'Executed', 'Passed', 'Failed', 'Blocked', 'Not assessed'],
          snapshot.coverage.map((row: any) => [
            row.framework_key,
            row.framework_version,
            String(row.planned ?? 0),
            String(row.passed ?? 0),
            String(row.failed ?? 0),
            String(row.blocked ?? 0),
            String(row.not_assessed ?? 0),
          ]),
          [0.26, 0.12, 0.14, 0.12, 0.12, 0.12, 0.12],
        );
      } else {
        body(doc, 'No test results were recorded for the selected scope.');
      }

      // Framework versions
      if (snapshot.frameworkVersions?.length) {
        section(doc, 'Framework catalogue versions used');
        table(
          doc,
          ['Framework', 'Version', 'Catalogue status'],
          snapshot.frameworkVersions.map((row: any) => [row.key, row.version, row.verificationStatus]),
          [0.4, 0.2, 0.4],
        );
        body(doc, 'Results are retained against the framework version in force at the time of assessment. Later catalogue updates do not rewrite historical results.');
      }

      // NIST
      if (snapshot.nist?.length) {
        section(doc, 'NIST Cybersecurity Framework 2.0 profile (current state)');
        body(
          doc,
          'Profile entries record the evidence status of each outcome. They are not an official NIST maturity score and are not derived from vulnerability counts. Statuses such as "evidence required" indicate that supporting evidence has not yet been reviewed.',
        );
        const order = ['not_assessed', 'evidence_required', 'partially_supported', 'supported', 'improvement_required', 'not_applicable'];
        const counts = order.map((status) => [status, snapshot.nist.filter((n: any) => n.status === status).length] as [string, number]);
        table(doc, ['Profile status', 'Outcomes'], counts.filter(([, count]) => count > 0).map(([status, count]) => [statusLabel(status), String(count)]), [0.6, 0.4]);
      }

      // Remediation
      if (snapshot.remediation?.length) {
        doc.addPage();
        section(doc, 'Remediation status');
        table(
          doc,
          ['Finding', 'Severity', 'Plan status', 'Target date', 'Overdue'],
          snapshot.remediation.slice(0, 80).map((row: any) => [
            row.reference,
            String(row.severity).toUpperCase(),
            row.status,
            row.targetDate ?? '-',
            row.overdue ? 'YES' : 'no',
          ]),
          [0.24, 0.16, 0.24, 0.2, 0.16],
        );
        if (snapshot.remediation.length > 80) {
          body(doc, `Showing 80 of ${snapshot.remediation.length} remediation plans. The complete table is available in the XLSX export.`);
        }
        const verified = snapshot.remediation.filter((r: any) => r.status === 'verified').length;
        body(doc, `${verified} of ${snapshot.remediation.length} remediation plans have been independently verified.`);
      }

      // Evidence manifest
      if (snapshot.evidenceManifest?.length) {
        section(doc, 'Evidence manifest');
        body(
          doc,
          'Evidence bodies are encrypted at rest and are not embedded in this report. The manifest below allows an authorised reviewer to verify that a specific artefact, identified by SHA-256, is unchanged.',
        );
        table(
          doc,
          ['Kind', 'Title', 'Size (bytes)', 'SHA-256 (first 16)', 'Redacted'],
          snapshot.evidenceManifest.slice(0, 60).map((row: any) => [
            row.kind,
            truncate(toSafeText(row.title), 34),
            String(row.sizeBytes),
            String(row.sha256).slice(0, 16),
            row.redacted ? 'yes' : 'no',
          ]),
          [0.16, 0.4, 0.14, 0.2, 0.1],
        );
        if (snapshot.evidenceManifest.length > 60) body(doc, `Showing 60 of ${snapshot.evidenceManifest.length} evidence records.`);
      }

      // Applicability statement
      section(doc, 'Applicability statement');
      body(
        doc,
        'Findings in this report reflect the configuration observed during the authorised testing window at the recorded point in time. Absence of a finding for any control does not confirm that the control is effective, particularly where a check is recorded as blocked or not assessed. Technical severity is expressed using CVSS v4.0 and is not adjusted for business context; contextual banking risk is recorded separately with its underlying rationale.',
      );

      footer();
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function confidentiality(snapshot: Snapshot): string {
  if (snapshot.reportType === 'supervisory_portfolio') return 'RESTRICTED - SUPERVISORY USE ONLY';
  return 'CONFIDENTIAL - SUPERVISORY ASSESSMENT';
}

function labelFor(type: string): string {
  const map: Record<string, string> = {
    executive: 'Executive report',
    technical: 'Technical report',
    supervisory_portfolio: 'Supervisory portfolio report',
    remediation_status: 'Remediation status report',
    coverage: 'Coverage report',
  };
  return map[type] ?? type;
}

function categoryLabel(category: string): string {
  const map: Record<string, string> = {
    commercial_bank: 'Commercial bank',
    microfinance_bank: 'Microfinance bank',
    payment_service_provider: 'Payment service provider',
    other: 'Other approved institution',
  };
  return map[category] ?? category;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    not_assessed: 'Not assessed',
    evidence_required: 'Evidence required',
    partially_supported: 'Partially supported',
    supported: 'Supported by evidence',
    improvement_required: 'Improvement required',
    not_applicable: 'Not applicable',
  };
  return map[status] ?? status;
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return 'not recorded';
  return new Date(value).toISOString().slice(0, 10);
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}...` : value;
}

function section(doc: PDFKit.PDFDocument, title: string) {
  if (doc.y > doc.page.height - 160) doc.addPage();
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text(toSafeText(title), { width: doc.page.width - 96 });
  const y = doc.y + 3;
  doc.moveTo(48, y).lineTo(doc.page.width - 48, y).lineWidth(0.8).strokeColor(LINE).stroke();
  doc.moveDown(0.6);
  doc.fillColor(SLATE);
}

function body(doc: PDFKit.PDFDocument, text: string) {
  doc.font('Helvetica').fontSize(9).fillColor(SLATE).text(toSafeText(text), { width: doc.page.width - 96, align: 'left', lineGap: 1.5 });
  doc.moveDown(0.4);
}

function bulletList(doc: PDFKit.PDFDocument, items: string[]) {
  doc.font('Helvetica').fontSize(8.5).fillColor(SLATE);
  for (const item of items) {
    doc.text(toSafeText(`- ${item}`), { width: doc.page.width - 96, indent: 6, lineGap: 1 });
  }
  doc.moveDown(0.4);
}

function keyValues(doc: PDFKit.PDFDocument, pairs: [string, string][]) {
  const width = (doc.page.width - 96) / 2;
  let column = 0;
  const startY = doc.y;
  let y = startY;
  for (const [key, value] of pairs) {
    const x = 48 + column * width;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(toSafeText(key), x, y, { width: width - 8 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(toSafeText(value), x, y + 10, { width: width - 8 });
    column += 1;
    if (column === 2) {
      column = 0;
      y += 30;
    }
  }
  doc.y = y + (column ? 30 : 4);
  doc.font('Helvetica').fontSize(9).fillColor(SLATE);
}

function table(doc: PDFKit.PDFDocument, headers: string[], rows: string[][], widths: number[]) {
  const total = doc.page.width - 96;
  const drawHeader = () => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(NAVY);
    let x = 48;
    headers.forEach((header, index) => {
      doc.text(toSafeText(header), x, y, { width: total * widths[index] - 4 });
      x += total * widths[index];
    });
    doc.moveDown(0.2);
    const lineY = doc.y;
    doc.moveTo(48, lineY).lineTo(doc.page.width - 48, lineY).lineWidth(0.6).strokeColor(LINE).stroke();
    doc.moveDown(0.25);
  };
  drawHeader();
  for (const row of rows) {
    if (doc.y > doc.page.height - 90) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    doc.font('Helvetica').fontSize(7.5).fillColor(SLATE);
    let x = 48;
    let maxHeight = 0;
    row.forEach((cell, index) => {
      const height = doc.heightOfString(toSafeText(cell), { width: total * widths[index] - 4 });
      doc.text(toSafeText(cell), x, y, { width: total * widths[index] - 4 });
      maxHeight = Math.max(maxHeight, height);
      x += total * widths[index];
    });
    doc.y = y + maxHeight + 3;
  }
  doc.moveDown(0.5);
}

function findingBlock(doc: PDFKit.PDFDocument, finding: any) {
  if (doc.y > doc.page.height - 170) doc.addPage();
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY).text(`${toSafeText(finding.reference)}  ${toSafeText(finding.title)}`, { width: doc.page.width - 96 });
  doc.moveDown(0.15);
  const scoreText = finding.cvssScore != null ? `CVSS v4.0 ${Number(finding.cvssScore).toFixed(1)} (${String(finding.technicalSeverity).toUpperCase()})` : 'CVSS v4.0 not scored';
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
    toSafeText(
      `${scoreText}  |  Contextual risk: ${finding.contextualRating ?? 'not assessed'}  |  Status: ${finding.status}  |  Confidence: ${finding.confidence}`,
    ),
    { width: doc.page.width - 96 },
  );
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(8).fillColor(SLATE).text(toSafeText(`Affected asset: ${finding.asset ?? 'not recorded'}${finding.endpoint ? ` (${finding.endpoint})` : ''}`), { width: doc.page.width - 96 });
  if (finding.frameworkRefs?.length) {
    doc.text(toSafeText(`Framework references: ${finding.frameworkRefs.join('; ')}`), { width: doc.page.width - 96 });
  }
  if (finding.cvssVector) {
    doc.font('Courier').fontSize(7).fillColor(SLATE).text(toSafeText(finding.cvssVector), { width: doc.page.width - 96 });
    doc.font('Helvetica').fontSize(8);
  }
  doc.moveDown(0.25);
  doc.fillColor(SLATE).text(toSafeText(finding.description), { width: doc.page.width - 96, lineGap: 1.2 });
  if (finding.businessImpact) {
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY).text('Business impact', { width: doc.page.width - 96 });
    doc.font('Helvetica').fontSize(8).fillColor(SLATE).text(toSafeText(finding.businessImpact), { width: doc.page.width - 96 });
  }
  if (finding.remediationSummary) {
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY).text('Remediation', { width: doc.page.width - 96 });
    doc.font('Helvetica').fontSize(8).fillColor(SLATE).text(toSafeText(finding.remediationSummary), { width: doc.page.width - 96 });
  }
  doc.moveDown(0.3);
  const y = doc.y;
  doc.moveTo(48, y).lineTo(doc.page.width - 48, y).lineWidth(0.5).strokeColor(LINE).stroke();
  doc.moveDown(0.2);
}
