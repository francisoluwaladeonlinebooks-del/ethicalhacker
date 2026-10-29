/**
 * Malware scanning adapter.
 *
 * Uploaded artefacts are untrusted. This module is the only place that decides
 * whether a file may be treated as safe enough to store and serve.
 *
 * The platform does not ship a scanner. Two honest behaviours are supported:
 *
 *   FICAP_MALWARE_SCANNER=http  — POST the bytes to an operator-supplied
 *                                 scanning service (ClamAV REST, ICAP gateway,
 *                                 vendor sandbox). The result is recorded.
 *   anything else (default)     — scanning is reported as NOT PERFORMED. The
 *                                 artefact is stored in quarantine-pending state
 *                                 and the interface says so. No file is ever
 *                                 described as clean when it was not scanned.
 *
 * A scanner that errors is treated as "not scanned", never as "clean".
 */

export type ScanState = 'clean' | 'infected' | 'not_performed' | 'error';

export type ScanResult = {
  state: ScanState;
  provider: string;
  /** Short, non-sensitive explanation rendered in the interface and audit log. */
  detail: string;
  signature?: string;
  checkedAt: string;
};

const TIMEOUT_MS = 20_000;
const MAX_SCAN_BYTES = 25 * 1024 * 1024;

function providerName(): string {
  const configured = (process.env.FICAP_MALWARE_SCANNER ?? 'none').toLowerCase();
  if (configured === 'http') return 'external-http';
  return 'none';
}

export function scannerConfigured(): boolean {
  return providerName() !== 'none' && Boolean(process.env.FICAP_SCANNER_ENDPOINT);
}

export function scannerDescription(): string {
  if (!scannerConfigured()) {
    return 'No malware scanner is configured. Uploaded files are recorded as not scanned and are not described as clean. Configure FICAP_MALWARE_SCANNER=http with FICAP_SCANNER_ENDPOINT to enable scanning.';
  }
  return `Uploaded files are submitted to the configured scanning service before they are treated as usable evidence. A scanner error is recorded as not scanned, never as clean.`;
}

/**
 * Scan a buffer. Never throws: a failure is a recorded outcome, so the caller
 * can decide whether to quarantine the artefact or refuse the upload.
 */
export async function scanBuffer(content: Buffer, filename: string): Promise<ScanResult> {
  const checkedAt = new Date().toISOString();
  const provider = providerName();

  if (!scannerConfigured()) {
    return {
      state: 'not_performed',
      provider: 'none',
      detail: 'No scanning service is configured. The file has not been examined for malware.',
      checkedAt,
    };
  }

  if (content.length > MAX_SCAN_BYTES) {
    return {
      state: 'error',
      provider,
      detail: `File exceeds the ${Math.round(MAX_SCAN_BYTES / 1024 / 1024)} MB scanning limit and was not scanned.`,
      checkedAt,
    };
  }

  const endpoint = process.env.FICAP_SCANNER_ENDPOINT as string;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Ficap-Filename': filename,
        ...(process.env.FICAP_SCANNER_TOKEN ? { Authorization: `Bearer ${process.env.FICAP_SCANNER_TOKEN}` } : {}),
      },
      body: new Uint8Array(content),
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        state: 'error',
        provider,
        detail: `The scanning service returned HTTP ${response.status}. The file is treated as not scanned.`,
        checkedAt,
      };
    }
    const payload = (await response.json().catch(() => null)) as { status?: string; signature?: string } | null;
    const status = String(payload?.status ?? '').toLowerCase();
    if (['clean', 'ok', 'passed'].includes(status)) {
      return { state: 'clean', provider, detail: 'The scanning service reported no detection.', checkedAt };
    }
    if (['infected', 'malicious', 'blocked', 'quarantine'].includes(status)) {
      return {
        state: 'infected',
        provider,
        detail: 'The scanning service reported a detection. The file is quarantined and cannot be downloaded.',
        signature: payload?.signature ? String(payload.signature).slice(0, 120) : undefined,
        checkedAt,
      };
    }
    return {
      state: 'error',
      provider,
      detail: 'The scanning service did not return a recognised verdict. The file is treated as not scanned.',
      checkedAt,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      state: 'error',
      provider,
      detail: aborted ? 'The scanning service timed out. The file is treated as not scanned.' : 'The scanning service could not be reached. The file is treated as not scanned.',
      checkedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** True when a stored artefact may be served to a user. */
export function isServedStatus(status: string, analysis: unknown): boolean {
  if (['quarantined', 'failed'].includes(status)) return false;
  const record = analysis as { scan?: ScanResult } | null;
  // Scanned-and-infected artefacts are never served, whatever the row status says.
  return record?.scan?.state !== 'infected';
}
