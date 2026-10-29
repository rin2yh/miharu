import type { IncidentState, NormalizedStatus } from "../domain";
import { toPlainText } from "./text";
import { PROVIDER_RESPONSE_LIMIT_BYTES, type ServiceConfig } from "../shared/config/services";

export class ProviderError extends Error {
  constructor(
    readonly code:
      | "upstream_http_error"
      | "not_found"
      | "invalid_response"
      | "invalid_payload"
      | "timeout"
      | "network_error",
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export type FetchLike = typeof fetch;

export async function fetchJson(
  url: string,
  signal: AbortSignal,
  fetcher: FetchLike = fetch,
  options: { distinguishNotFound?: boolean } = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      signal,
      headers: {
        accept: "application/json",
        "user-agent": "saas-status-dashboard/0.1",
      },
    });
  } catch {
    if (signal.aborted) throw new ProviderError("timeout", "Status source request timed out");
    throw new ProviderError("network_error", "Status source request failed");
  }

  if (response.status === 404 && options.distinguishNotFound) {
    throw new ProviderError("not_found", "Status source did not find the requested resource");
  }
  if (!response.ok) {
    throw new ProviderError(
      "upstream_http_error",
      `Status source returned HTTP ${response.status}`,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!/\bjson\b/i.test(contentType)) {
    throw new ProviderError("invalid_response", "Status source did not return JSON");
  }

  const text = await readLimitedText(response);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError("invalid_payload", "Status source returned invalid JSON");
  }
}

export async function fetchText(
  url: string,
  signal: AbortSignal,
  fetcher: FetchLike = fetch,
): Promise<string> {
  return fetchTextResponse(
    url,
    signal,
    fetcher,
    "application/rss+xml, application/xml, text/xml",
    /(?:rss\+xml|application\/xml|text\/xml)/i,
    "XML feed",
  );
}

export async function fetchHtml(
  url: string,
  signal: AbortSignal,
  fetcher: FetchLike = fetch,
): Promise<string> {
  return fetchTextResponse(url, signal, fetcher, "text/html", /\btext\/html\b/i, "HTML page");
}

async function fetchTextResponse(
  url: string,
  signal: AbortSignal,
  fetcher: FetchLike,
  accept: string,
  contentTypePattern: RegExp,
  expectedType: string,
): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(url, {
      signal,
      headers: {
        accept,
        "user-agent": "saas-status-dashboard/0.1",
      },
    });
  } catch {
    if (signal.aborted) throw new ProviderError("timeout", "Status source request timed out");
    throw new ProviderError("network_error", "Status source request failed");
  }

  if (!response.ok) {
    throw new ProviderError(
      "upstream_http_error",
      `Status source returned HTTP ${response.status}`,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentTypePattern.test(contentType)) {
    throw new ProviderError("invalid_response", `Status source did not return an ${expectedType}`);
  }
  return readLimitedText(response);
}

async function readLimitedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PROVIDER_RESPONSE_LIMIT_BYTES) {
        await reader.cancel();
        throw new ProviderError(
          "invalid_response",
          "Status source response exceeded the size limit",
        );
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function boundedText(value: unknown, maxLength = 3_000): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

export function statusText(value: unknown, maxLength = 3_000): string | null {
  return toPlainText(value, maxLength);
}

export function requiredText(value: unknown, label: string, maxLength = 300): string {
  const text = boundedText(value, maxLength);
  if (!text) throw new ProviderError("invalid_payload", `Missing ${label}`);
  return text;
}

export function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

const INCIDENT_STATES: Record<string, IncidentState> = {
  resolved: "resolved",
  closed: "resolved",
  complete: "resolved",
  completed: "resolved",
  cancelled: "resolved",
  canceled: "resolved",
  postmortem: "resolved",
  scheduled: "scheduled",
  in_progress: "in_progress",
  in_progress_maintenance: "in_progress",
  monitoring: "monitoring",
  identified: "identified",
  investigating: "investigating",
  active: "investigating",
  open: "investigating",
};

export function parseIncidentState(value: string): IncidentState {
  const normalized = value.toLowerCase().replaceAll(/[- ]/g, "_");
  return Object.hasOwn(INCIDENT_STATES, normalized) ? INCIDENT_STATES[normalized] : "unknown";
}

export function statusFromImpact(value: unknown): NormalizedStatus | null {
  if (typeof value !== "string") return null;
  switch (value.toLowerCase()) {
    case "minor":
      return "degraded_performance";
    case "major":
      return "partial_outage";
    case "critical":
      return "major_outage";
    case "maintenance":
      return "under_maintenance";
    default:
      return null;
  }
}

export function safeIncidentUrl(value: unknown, service: ServiceConfig): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !service.allowedLinkHosts.includes(url.hostname.toLowerCase()))
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function uniqueNames(values: unknown[], maxItems = 40): string[] {
  return [
    ...new Set(
      values.map((value) => boundedText(value, 100)).filter((v): v is string => Boolean(v)),
    ),
  ].slice(0, maxItems);
}
