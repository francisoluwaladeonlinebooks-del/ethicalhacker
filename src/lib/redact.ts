/**
 * Automatic redaction of sensitive values from collected evidence.
 *
 * Evidence captured during an assessment can contain customer data, bearer
 * tokens and session identifiers. Everything that leaves an assessment engine
 * is passed through `redactText` before it is encrypted and stored.
 */

export type Redaction = { type: string; count: number };

export type RedactionResult = { text: string; redactions: Redaction[] };

const RULES: { type: string; pattern: RegExp; replacement: string }[] = [
  { type: 'private_key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: '[REDACTED PRIVATE KEY]' },
  { type: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replacement: '[REDACTED JWT]' },
  { type: 'bearer_token', pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/=]{12,}/gi, replacement: '$1 [REDACTED]' },
  { type: 'api_key', pattern: /\b(api[_-]?key|apikey|x-api-key|client_secret|client-secret|access_token|refresh_token|secret|password|passwd|pwd|token)\b(\s*[:=]\s*)("?)([^"'&\s,}]{4,})\3/gi, replacement: '$1$2$3[REDACTED]$3' },
  { type: 'authorization_header', pattern: /(authorization\s*:\s*)(?!\[REDACTED)[^\r\n]+/gi, replacement: '$1[REDACTED]' },
  { type: 'set_cookie', pattern: /(set-cookie\s*:\s*)(?!\[REDACTED)[^\r\n]+/gi, replacement: '$1[REDACTED COOKIE]' },
  { type: 'cookie_header', pattern: /(^|\n)(cookie\s*:\s*)[^\r\n]+/gi, replacement: '$1$2[REDACTED COOKIE]' },
  { type: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: '[REDACTED EMAIL]' },
  { type: 'bvn', pattern: /\bBVN[:\s]*\d{11}\b/gi, replacement: 'BVN [REDACTED]' },
  { type: 'nin', pattern: /\bNIN[:\s]*\d{11}\b/gi, replacement: 'NIN [REDACTED]' },
  { type: 'card_number', pattern: /\b(?:\d[ -]*?){13,19}\b/g, replacement: '[REDACTED NUMBER]' },
  { type: 'phone', pattern: /(?:\+234|0)[789][01]\d{8}\b/g, replacement: '[REDACTED PHONE]' },
  { type: 'account_number', pattern: /\b(account|acct|nuban)[_\s-]?(number|no|num)?["'\s:=]+\d{10}\b/gi, replacement: 'account number [REDACTED]' },
  { type: 'iban', pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, replacement: '[REDACTED IBAN]' },
  { type: 'session_id', pattern: /\b(JSESSIONID|PHPSESSID|ASP\.NET_SessionId|sessionid|session_id)\s*[=:]\s*[^\s;,"']{6,}/gi, replacement: '$1=[REDACTED]' },
];

const MAX_EVIDENCE_CHARS = 200_000;

export function redactText(input: string): RedactionResult {
  let text = typeof input === 'string' ? input : String(input ?? '');
  const counts = new Map<string, number>();

  for (const rule of RULES) {
    text = text.replace(rule.pattern, (...args) => {
      const match = args[0] as string;
      // Skip values that are already masked so repeated processing is stable.
      if (/\[REDACTED/.test(match)) return match;
      counts.set(rule.type, (counts.get(rule.type) ?? 0) + 1);
      // Support $1 style back references in replacement templates.
      return match.replace(rule.pattern, rule.replacement);
    });
  }

  // High entropy strings that look like embedded secrets (>= 32 chars, mixed).
  text = text.replace(/\b(?=[A-Za-z0-9+/=_-]{32,}\b)(?=[^ \n]*[A-Z])(?=[^ \n]*[a-z])(?=[^ \n]*\d)[A-Za-z0-9+/=_-]{32,}\b/g, (match) => {
    if (/^[0-9a-f]{32,}$/i.test(match)) {
      counts.set('hex_secret', (counts.get('hex_secret') ?? 0) + 1);
      return '[REDACTED SECRET]';
    }
    counts.set('high_entropy_secret', (counts.get('high_entropy_secret') ?? 0) + 1);
    return '[REDACTED SECRET]';
  });

  if (text.length > MAX_EVIDENCE_CHARS) {
    text = `${text.slice(0, MAX_EVIDENCE_CHARS)}\n\n[TRUNCATED: evidence exceeded ${MAX_EVIDENCE_CHARS} characters]`;
    counts.set('truncated', 1);
  }

  return {
    text,
    redactions: [...counts.entries()].map(([type, count]) => ({ type, count })),
  };
}

/** Redact selected response headers while preserving security-relevant ones. */
export function redactHeaders(headers: Record<string, string | string[]>): Record<string, string | string[]> {
  const sensitive = new Set([
    'authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'proxy-authorization',
    'x-auth-token',
    'x-access-token',
    'x-session-token',
  ]);
  const output: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (sensitive.has(key.toLowerCase())) {
      const raw = Array.isArray(value) ? value.join('\n') : value;
      const { text } = redactText(raw);
      // Preserve attribute structure for cookie analysis but hide the secret.
      output[key] = text
        .replace(/=[^;,\s]+/g, '=[REDACTED]')
        .split('\n')
        .join(' | ');
    } else {
      output[key] = value;
    }
  }
  return output;
}

/**
 * Detect whether text still contains obvious sensitive identifiers.
 *
 * Used as a last line of defence before evidence is stored or returned: a match
 * means the caller must redact (or refuse to store) rather than pass the text on.
 */
export function containsUnredactedSensitiveData(text: string): boolean {
  const patterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
    /\bbearer\s+[A-Za-z0-9._~+/-]{16,}=*/i,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\b(?:password|passwd|secret|api[_\-]?key|client[_\-]?secret)\s*[=:]\s*(?!\[REDACTED)[^\s"',;]{6,}/i,
  ];
  return patterns.some((pattern) => pattern.test(text));
}
