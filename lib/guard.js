/**
 * Guardrails: PII redaction and prompt-injection detection.
 *
 * Pure, dependency-free heuristics intended as a fast first line of defence
 * (telemetry redaction, logging hygiene, flagging suspicious user input). They
 * are deliberately conservative and are not a substitute for a dedicated
 * moderation model.
 */

const PII_PATTERNS = [
  { type: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, mask: '[REDACTED_EMAIL]' },
  { type: 'api_key', re: /\b(?:sk|gsk|sk-ant|sk-or|ghp|gho|github_pat)[-_][A-Za-z0-9_-]{16,}\b/g, mask: '[REDACTED_KEY]' },
  { type: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/g, mask: '[REDACTED_SSN]' },
  { type: 'credit_card', re: /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{1,4}\b/g, mask: '[REDACTED_CC]' },
  { type: 'phone', re: /\b(?:\+?\d{1,3}[ .-]?)?(?:\(?\d{3}\)?[ .-]?)\d{3}[ .-]?\d{4}\b/g, mask: '[REDACTED_PHONE]' },
];

/** Redact common PII from a string. Returns { text, redactions, count }. */
export function redactPII(input) {
  let text = String(input ?? '');
  const redactions = [];
  for (const { type, re, mask } of PII_PATTERNS) {
    text = text.replace(re, (m) => {
      redactions.push({ type, value: m });
      return mask;
    });
  }
  return { text, redactions, count: redactions.length };
}

const INJECTION_PATTERNS = [
  /ignore (?:all )?(?:the )?(?:previous|prior|above) instructions/i,
  /disregard (?:the )?(?:previous|prior|above|system)/i,
  /forget (?:everything|all (?:previous|prior))/i,
  /reveal (?:your )?(?:system )?prompt/i,
  /print (?:your )?(?:system )?(?:prompt|instructions)/i,
  /(?:developer|system) mode/i,
  /jailbreak|DAN mode/i,
  /override (?:your )?(?:safety|guidelines|instructions)/i,
  /pretend (?:to be|you are)/i,
  /you are now /i,
];

/** Heuristically detect prompt-injection attempts. Returns { injection, score, flags }. */
export function detectInjection(input) {
  const text = String(input ?? '');
  const flags = [];
  for (const re of INJECTION_PATTERNS) {
    const m = re.exec(text);
    if (m) flags.push(m[0]);
  }
  return { injection: flags.length > 0, score: Math.min(1, flags.length / 3), flags };
}

/** Convenience: run both checks and return a redacted safeText. */
export function scanText(input) {
  const pii = redactPII(input);
  const injection = detectInjection(input);
  return { pii, injection, safeText: pii.text };
}
