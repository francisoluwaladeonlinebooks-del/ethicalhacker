import ExcelJS from 'exceljs';
import { toSafeText } from '@/lib/reporting/report';

/**
 * XLSX export of a stored report snapshot. Every worksheet is derived from the
 * snapshot, so an approved report always exports exactly what was approved.
 */
export async function renderReportXlsx(snapshot: any): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FICAP';
  workbook.created = new Date(snapshot.generatedAt);
  workbook.title = toSafeText(snapshot.title);

  const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF12224A' } };
  const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  const styleHeader = (sheet: ExcelJS.Worksheet) => {
    const row = sheet.getRow(1);
    row.font = headerFont;
    row.eachCell((cell) => {
      cell.fill = headerFill;
      cell.alignment = { vertical: 'middle' };
    });
    row.height = 20;
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  };

  // Summary sheet
  const summary = workbook.addWorksheet('Summary');
  summary.columns = [
    { header: 'Field', key: 'field', width: 42 },
    { header: 'Value', key: 'value', width: 70 },
  ];
  const s = snapshot.summary ?? {};
  const rows: [string, string][] = [
    ['Report title', snapshot.title],
    ['Report type', snapshot.reportType],
    ['Data mode', snapshot.dataMode === 'demo' ? 'DEMONSTRATION DATA - NOT A LIVE RECORD' : 'LIVE'],
    ['Generated at (UTC)', snapshot.generatedAt],
    ['Institution', snapshot.institution ? `${snapshot.institution.name} (${snapshot.institution.code})` : 'Supervisory portfolio'],
    ['Institution category', snapshot.institution?.category ?? '-'],
    ['Engagement', snapshot.engagement ? `${snapshot.engagement.code} - ${snapshot.engagement.name}` : '-'],
    ['Authorisation reference', snapshot.engagement?.authorizationRef ?? '-'],
    ['Scope valid from', snapshot.engagement?.scopeApprovedAt ?? '-'],
    ['Scope expires', snapshot.engagement?.scopeExpiresAt ?? '-'],
    ['Findings recorded', String(s.totalFindings ?? 0)],
    ['Open findings', String(s.openFindings ?? 0)],
    ['Confirmed (independently verified)', String(s.confirmed ?? 0)],
    ['Suspected (verification outstanding)', String(s.suspected ?? 0)],
    ['Observations', String(s.observation ?? 0)],
    ['Highest technical severity', String(s.highestSeverity ?? 'none').toUpperCase()],
    ['Checks blocked', String(s.blockedChecks ?? 0)],
    ['Checks not assessed', String(s.notAssessedChecks ?? 0)],
    ['Remediation verified', String(s.verifiedRemediation ?? 0)],
    ['Remediation overdue', String(s.overdueRemediation ?? 0)],
  ];
  for (const [field, value] of rows) summary.addRow({ field, value: toSafeText(value) });
  styleHeader(summary);

  const limitations = workbook.addWorksheet('Limitations');
  limitations.columns = [
    { header: 'Statement', key: 'statement', width: 120 },
  ];
  for (const line of snapshot.limitations ?? []) limitations.addRow({ statement: toSafeText(line) });
  styleHeader(limitations);

  // Findings
  const findings = workbook.addWorksheet('Findings');
  findings.columns = [
    { header: 'Reference', key: 'reference', width: 16 },
    { header: 'Classification', key: 'classification', width: 14 },
    { header: 'Title', key: 'title', width: 52 },
    { header: 'Category', key: 'category', width: 26 },
    { header: 'Asset', key: 'asset', width: 30 },
    { header: 'Status', key: 'status', width: 22 },
    { header: 'CVSS v4.0', key: 'cvss', width: 11 },
    { header: 'Severity', key: 'severity', width: 11 },
    { header: 'Vector', key: 'vector', width: 62 },
    { header: 'Contextual risk', key: 'contextual', width: 15 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Confidence', key: 'confidence', width: 11 },
    { header: 'Verified', key: 'verified', width: 10 },
    { header: 'Due date', key: 'due', width: 12 },
    { header: 'Framework references', key: 'frameworks', width: 42 },
    { header: 'Description', key: 'description', width: 70 },
    { header: 'Business impact', key: 'business', width: 60 },
  ];
  for (const finding of snapshot.findings ?? []) {
    findings.addRow({
      reference: finding.reference,
      classification: finding.classification,
      title: toSafeText(finding.title),
      category: finding.category,
      asset: toSafeText(finding.asset ?? '-'),
      status: finding.status,
      cvss: finding.cvssScore ?? '-',
      severity: String(finding.technicalSeverity).toUpperCase(),
      vector: finding.cvssVector ?? '-',
      contextual: finding.contextualRating ?? '-',
      priority: finding.priorityRank ? `P${finding.priorityRank}` : '-',
      confidence: finding.confidence,
      verified: finding.verified ? 'yes' : 'no',
      due: finding.dueDate ?? '-',
      frameworks: (finding.frameworkRefs ?? []).join('; ') || '-',
      description: toSafeText(finding.description),
      business: toSafeText(finding.businessImpact ?? '-'),
    });
  }
  styleHeader(findings);
  findings.eachRow((row, index) => {
    if (index === 1) return;
    const classification = String(row.getCell('classification').value ?? '');
    if (classification === 'confirmed') row.getCell('classification').font = { bold: true, color: { argb: 'FF7F1D1D' } };
    if (classification === 'suspected') row.getCell('classification').font = { italic: true, color: { argb: 'FF8A6100' } };
    row.getCell('vector').font = { name: 'Consolas', size: 9 };
  });

  // Coverage
  const coverage = workbook.addWorksheet('Coverage');
  coverage.columns = [
    { header: 'Framework', key: 'framework', width: 24 },
    { header: 'Version', key: 'version', width: 12 },
    { header: 'Executed', key: 'planned', width: 11 },
    { header: 'Passed', key: 'passed', width: 10 },
    { header: 'Failed', key: 'failed', width: 10 },
    { header: 'Blocked', key: 'blocked', width: 10 },
    { header: 'Not assessed', key: 'notAssessed', width: 14 },
    { header: 'Not applicable', key: 'na', width: 15 },
    { header: 'Needs verification', key: 'nv', width: 18 },
  ];
  for (const row of snapshot.coverage ?? []) {
    coverage.addRow({
      framework: row.framework_key,
      version: row.framework_version,
      planned: row.planned,
      passed: row.passed,
      failed: row.failed,
      blocked: row.blocked,
      notAssessed: row.not_assessed,
      na: row.not_applicable,
      nv: row.needs_verification,
    });
  }
  styleHeader(coverage);

  // Remediation
  const remediation = workbook.addWorksheet('Remediation');
  remediation.columns = [
    { header: 'Finding', key: 'reference', width: 16 },
    { header: 'Title', key: 'title', width: 52 },
    { header: 'Severity', key: 'severity', width: 11 },
    { header: 'Plan status', key: 'status', width: 16 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Target date', key: 'target', width: 13 },
    { header: 'Overdue', key: 'overdue', width: 10 },
    { header: 'Verification criteria', key: 'criteria', width: 60 },
  ];
  for (const row of snapshot.remediation ?? []) {
    remediation.addRow({
      reference: row.reference,
      title: toSafeText(row.title),
      severity: String(row.severity).toUpperCase(),
      status: row.status,
      priority: row.priority,
      target: row.targetDate ?? '-',
      overdue: row.overdue ? 'YES' : 'no',
      criteria: toSafeText(row.verificationCriteria ?? '-'),
    });
  }
  styleHeader(remediation);

  // Evidence manifest
  const evidence = workbook.addWorksheet('Evidence manifest');
  evidence.columns = [
    { header: 'Evidence ID', key: 'id', width: 38 },
    { header: 'Kind', key: 'kind', width: 16 },
    { header: 'Title', key: 'title', width: 50 },
    { header: 'Media type', key: 'mediaType', width: 18 },
    { header: 'Size (bytes)', key: 'size', width: 13 },
    { header: 'SHA-256', key: 'sha', width: 68 },
    { header: 'Classification', key: 'classification', width: 16 },
    { header: 'Redacted', key: 'redacted', width: 10 },
    { header: 'Shared with institution', key: 'shared', width: 22 },
  ];
  for (const row of snapshot.evidenceManifest ?? []) {
    evidence.addRow({
      id: row.id,
      kind: row.kind,
      title: toSafeText(row.title),
      mediaType: row.mediaType,
      size: row.sizeBytes,
      sha: row.sha256,
      classification: row.classification,
      redacted: row.redacted ? 'yes' : 'no',
      shared: row.sharedWithInstitution ? 'yes' : 'no',
    });
  }
  styleHeader(evidence);

  // NIST profile
  if (snapshot.nist?.length) {
    const nist = workbook.addWorksheet('NIST CSF 2.0');
    nist.columns = [
      { header: 'Outcome', key: 'code', width: 14 },
      { header: 'Evidence status', key: 'status', width: 24 },
      { header: 'Recorded gap', key: 'gap', width: 80 },
    ];
    for (const row of snapshot.nist) nist.addRow({ code: row.itemCode, status: row.status, gap: toSafeText(row.gap ?? '-') });
    styleHeader(nist);
    const note = nist.addRow({ code: '', status: 'Note', gap: 'Profile statuses are evidence statuses, not an official NIST maturity score. Statuses are not derived from vulnerability counts.' });
    note.font = { italic: true, color: { argb: 'FF6D778C' } };
  }

  // Framework versions
  const versions = workbook.addWorksheet('Framework versions');
  versions.columns = [
    { header: 'Framework', key: 'key', width: 26 },
    { header: 'Name', key: 'name', width: 44 },
    { header: 'Version', key: 'version', width: 12 },
    { header: 'Catalogue status', key: 'status', width: 24 },
  ];
  for (const row of snapshot.frameworkVersions ?? []) versions.addRow({ key: row.key, name: row.name, version: row.version, status: row.verificationStatus });
  styleHeader(versions);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
