/**
 * CLERK — Redaction
 *
 * The Clerk records everything, which is the point. That makes it a permanent, plaintext copy of
 * every command you ever ran — including the ones where a token was on the command line. Recording
 * without redaction turns "I was careful not to print secrets" into "my secrets are in a log file
 * forever", and unlike a terminal scrollback this file is designed to outlive the session.
 *
 * TWO RULES, and the second is the one that is easy to get wrong:
 *
 *   1. Redact known credential shapes before anything is written to disk.
 *
 *   2. REDACT VISIBLY. Never silently drop the text. A record that quietly shortens itself is worse
 *      than one that says "something was here" — you cannot tell a command that had no secret from
 *      a command whose secret was removed, and you will eventually read the gap as "nothing was
 *      there". Every redaction leaves `[REDACTED:<kind>]` behind, so the absence is legible.
 *
 * Patterns are matched by SHAPE, not by variable name: a secret assigned to `FOO=` is still a
 * secret. Shape-matching also means an unknown-but-obviously-credential-looking string is caught
 * without anyone having to enumerate it first.
 */

'use strict';

// Ordered: longer/more-specific shapes first so a broad rule cannot eat a precise one.
const PATTERNS = [
  // Vendor-prefixed API keys (Shopify admin/storefront, spike-chat, Stripe, GitHub, Slack, OpenAI…)
  { kind: 'shopify-token', re: /\bshp(at|ca|pa|ss)_[A-Za-z0-9]{16,}/g },
  { kind: 'spike-chat-key', re: /\bsca_[A-Za-z0-9_-]{16,}/g },
  { kind: 'stripe-key', re: /\b[sr]k_(live|test)_[A-Za-z0-9]{16,}/g },
  { kind: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { kind: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { kind: 'aws-key-id', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'google-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  // Google OAuth access tokens (ya29.…) and refresh tokens (1//…) — raised by @Gamal, who emits
  // these routinely through the Ads pipe. Shapes he sees every day are exactly the ones a
  // pattern list written by someone else forgets.
  { kind: 'google-oauth', re: /\bya29\.[A-Za-z0-9_-]{20,}/g },
  { kind: 'google-refresh', re: /\b1\/\/[A-Za-z0-9_-]{30,}/g },

  // JWTs and Cloudflare tunnel tokens (base64url JSON, three or more dot-joined segments)
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}={0,2}(?:\.[A-Za-z0-9_-]+={0,2}){1,2}/g },
  // Cloudflare's `cloudflared --token` value is a single long base64url blob starting eyJ
  { kind: 'cf-tunnel-token', re: /\beyJ[A-Za-z0-9_-]{60,}={0,2}/g },

  // Connection strings — the password is the point, but the whole URI identifies infrastructure.
  { kind: 'db-uri', re: /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s'"`]+/gi },

  // Private key blocks
  { kind: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },

  // Generic assignments: KEY=…, token: "…", password '…', Authorization: Bearer …
  { kind: 'bearer', re: /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{12,}={0,2}/g },
  {
    kind: 'assigned-secret',
    re: /\b([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL|AUTH)[A-Za-z0-9_]*)\s*[=:]\s*["']?([^\s"'`,;)]{6,})/gi,
  },
  // url/query params: ?key=… &token=… &access_token=…
  {
    kind: 'url-param-secret',
    re: /\b((?:api_?key|access_?token|auth|key|token|secret|password|signature|sig)=)([^\s&"'`]{6,})/gi,
  },
];

/**
 * Replace credential-shaped substrings with a visible marker.
 * Returns { text, redactions } — redactions is the list of kinds removed, so a caller can record
 * that redaction happened even if it chooses not to keep the marker inline.
 */
function redact(value) {
  if (value == null) return { text: '', redactions: [] };
  let text = typeof value === 'string' ? value : safeStringify(value);
  const redactions = [];

  for (const { kind, re } of PATTERNS) {
    text = text.replace(re, (match, g1, g2) => {
      redactions.push(kind);
      // For assignment-shaped matches keep the NAME and redact only the value: knowing that
      // CF_TUNNEL_TOKEN was set is useful; knowing its value is a liability.
      if ((kind === 'assigned-secret' || kind === 'url-param-secret') && g1 !== undefined) {
        return `${g1}[REDACTED:${kind}]`;
      }
      return `[REDACTED:${kind}]`;
    });
  }
  return { text, redactions };
}

function safeStringify(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Convenience: redact and return only the text. */
function redactText(value) {
  return redact(value).text;
}

module.exports = { redact, redactText, PATTERNS };
