/**
 * Input guardrails: URL normalization, SSRF / allowlist protection, domain
 * scoping, and persona sanitization. The agent ingests untrusted URLs, so this
 * is the gate before any scrape happens.
 */

export class UrlBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlBlockedError";
  }
}

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./, // link-local + cloud metadata
  /^0\./,
  /^::1$/,
  /^fe80:/i,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
]);

export function normalizeUrl(input: string): string {
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }
  const url = new URL(raw);
  url.hash = "";
  return url.toString();
}

/** Best-effort registrable domain (eTLD+1). Good enough for scoping/keys. */
export function getRegistrableDomain(input: string): string {
  const url = new URL(normalizeUrl(input));
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  // Handle common two-level public suffixes (co.uk, com.au, etc).
  const twoLevel = ["co", "com", "org", "net", "gov", "edu", "ac"];
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  if (twoLevel.includes(sld) && tld.length === 2) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (!host.includes(".")) return true; // bare hostnames → internal
  return PRIVATE_IP_PATTERNS.some((p) => p.test(host));
}

export interface UrlValidationOptions {
  /** Restrict to this registrable domain (+ subdomains). */
  scopeDomain?: string;
}

export function validateUrl(
  input: string,
  options: UrlValidationOptions = {},
): string {
  let url: URL;
  try {
    url = new URL(normalizeUrl(input));
  } catch {
    throw new UrlBlockedError(`Invalid URL: ${input}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlBlockedError(`Only http(s) URLs are allowed: ${input}`);
  }

  if (url.port && !["", "80", "443"].includes(url.port)) {
    throw new UrlBlockedError(`Non-standard port not allowed: ${input}`);
  }

  if (isPrivateHost(url.hostname)) {
    throw new UrlBlockedError(`Refusing to fetch internal/private host: ${url.hostname}`);
  }

  if (options.scopeDomain) {
    const domain = getRegistrableDomain(url.toString());
    if (domain !== options.scopeDomain) {
      throw new UrlBlockedError(
        `URL ${url.hostname} is outside the allowed domain ${options.scopeDomain}.`,
      );
    }
  }

  return url.toString();
}

export function isUrlAllowed(input: string, options: UrlValidationOptions = {}): boolean {
  try {
    validateUrl(input, options);
    return true;
  } catch {
    return false;
  }
}

/** Strip control characters and clamp length on free-text persona fields. */
export function sanitizePersonaField(value: string, max = 80): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
