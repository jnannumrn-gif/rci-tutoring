// Anti-bot / junk-signup checks shared by the registration endpoints.

const MIN_FORM_FILL_MS = 2500;
const MAX_SIGNUPS_PER_IP_24H = 3;

const TYPO_DOMAINS = {
  'gmai.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gmial.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'yaho.com': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'outlok.com': 'outlook.com',
  'iclould.com': 'icloud.com',
  'icloud.co': 'icloud.com'
};

/**
 * Structural email validation, stricter than the `a@b.c` regex used by the UI.
 * Catches the malformed addresses bots submit (`x@jmail..com`, `x@gmai.comn`).
 */
export function validateEmailFormat(email) {
  const value = (email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(value)) return { ok: false, reason: 'format' };

  const [local, domain] = value.split('@');
  if (local.length < 1 || local.length > 64) return { ok: false, reason: 'format' };
  if (domain.length > 253) return { ok: false, reason: 'format' };
  if (domain.includes('..') || domain.startsWith('.') || domain.startsWith('-')) {
    return { ok: false, reason: 'format' };
  }

  const labels = domain.split('.');
  if (labels.length < 2) return { ok: false, reason: 'format' };
  if (labels.some(function(l) { return !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(l); })) {
    return { ok: false, reason: 'format' };
  }

  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,24}$/.test(tld)) return { ok: false, reason: 'format' };

  if (TYPO_DOMAINS[domain]) {
    return { ok: false, reason: 'typo', suggestion: local + '@' + TYPO_DOMAINS[domain] };
  }

  return { ok: true, domain: domain };
}

/**
 * Reject a domain that cannot receive email at all (no MX records), which is
 * what the throwaway domains bots invent look like. Fails open on DNS errors
 * so a resolver outage never blocks real signups.
 */
export async function domainAcceptsEmail(domain) {
  try {
    const res = await fetch(
      'https://cloudflare-dns.com/dns-query?type=MX&name=' + encodeURIComponent(domain),
      { headers: { accept: 'application/dns-json' } }
    );
    if (!res.ok) return true;
    const data = await res.json();
    if (data.Status === 3) return false; // NXDOMAIN
    if (data.Status !== 0) return true;
    const mx = (data.Answer || []).filter(function(a) { return a.type === 15; });
    return mx.length > 0;
  } catch (err) {
    console.error('[ANTIBOT] MX lookup failed for', domain, err.message);
    return true;
  }
}

/**
 * Bots fill the name field with a phone number ("09122105224", "+67075374149").
 */
export function nameLooksLikePhone(nombre) {
  const value = (nombre || '').trim();
  const digits = (value.match(/\d/g) || []).length;
  if (digits >= 6) return true;
  const compact = value.replace(/[\s()+.\-]/g, '');
  return compact.length > 0 && digits / compact.length > 0.5;
}

/**
 * Hidden field no human ever sees, plus a minimum time spent on the form.
 * `form_ms` is how long the page was open before submitting.
 */
export function looksAutomated(body) {
  if (body.website) return { bot: true, signal: 'honeypot' };
  const elapsed = Number(body.form_ms);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_FORM_FILL_MS) {
    return { bot: true, signal: 'too_fast' };
  }
  return { bot: false };
}

/**
 * Cap signups per IP per day. Fails open if the query errors.
 */
export async function ipOverSignupLimit(db, ip) {
  if (!ip) return false;
  try {
    const row = await db.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE registration_ip = ? AND created_at >= datetime('now', '-1 day')"
    ).bind(ip).first();
    return (row && row.n) >= MAX_SIGNUPS_PER_IP_24H;
  } catch (err) {
    console.error('[ANTIBOT] IP rate-limit query failed:', err.message);
    return false;
  }
}

/**
 * Cloudflare Turnstile verification. Skipped entirely while
 * TURNSTILE_SECRET_KEY is unset, so the site keeps working before the keys
 * are configured.
 */
export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return { ok: true, skipped: true };
  if (!token) return { ok: false };
  try {
    const form = new FormData();
    form.append('secret', env.TURNSTILE_SECRET_KEY);
    form.append('response', token);
    if (ip) form.append('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form
    });
    const data = await res.json();
    return { ok: data.success === true };
  } catch (err) {
    console.error('[ANTIBOT] Turnstile verify failed:', err.message);
    return { ok: true, skipped: true };
  }
}
