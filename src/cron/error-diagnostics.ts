export interface ErrorDiagnostics {
  errorType: string;
  errorCategory: ErrorCategory;
  errorMessage?: string;
  errorCause?: string;
}

export type ErrorCategory =
  | "D1"
  | "KV"
  | "Discord"
  | "external_api"
  | "timeout"
  | "notification"
  | "cron";
export const MAX_ERROR_DETAIL_LENGTH = 8_000;

export function getErrorDiagnostics(error: unknown): ErrorDiagnostics {
  if (error instanceof Error) {
    const details = boundDetails(error.message, formatCause(error.cause));
    return {
      errorType: /^[A-Za-z][\w.]{0,63}$/.test(error.name) ? error.name : "Error",
      errorCategory: classifyError(error),
      ...(details.errorMessage !== undefined ? { errorMessage: details.errorMessage } : {}),
      ...(details.errorCause ? { errorCause: details.errorCause } : {}),
    };
  }
  const message = error === undefined ? undefined : formatCause(error);
  const details = boundDetails(message);
  return {
    errorType: "UnknownError",
    errorCategory: "cron",
    ...(details.errorMessage !== undefined ? { errorMessage: details.errorMessage } : {}),
  };
}

function classifyError(error: Error): ErrorCategory {
  if (/AbortError|TimeoutError/.test(error.name)) return "timeout";
  if (error.name === "ProviderError") return "external_api";
  if (/Collection(Store|Persistence)Error/.test(error.name)) return "D1";
  if (/KV/.test(error.name)) return "KV";
  if (/Discord|Webhook/.test(error.name)) return "Discord";
  return "notification";
}

function boundDetails(
  message?: string,
  cause?: string,
): { errorMessage?: string; errorCause?: string } {
  const suffix = "…[error details truncated at 8000 characters]";
  if (message === undefined && cause === undefined) return {};
  const fullLength = (message?.length ?? 0) + (cause?.length ?? 0);
  if (fullLength <= MAX_ERROR_DETAIL_LENGTH) {
    return {
      ...(message !== undefined ? { errorMessage: message } : {}),
      ...(cause ? { errorCause: cause } : {}),
    };
  }
  const available = Math.max(0, MAX_ERROR_DETAIL_LENGTH - suffix.length);
  const boundedMessage = message?.slice(0, Math.min(message.length, available));
  const remaining = available - (boundedMessage?.length ?? 0);
  const boundedCause = cause?.slice(0, remaining);
  if (message !== undefined && (boundedMessage?.length ?? 0) < message.length) {
    return { errorMessage: `${boundedMessage ?? ""}${suffix}` };
  }
  return {
    ...(boundedMessage !== undefined ? { errorMessage: boundedMessage } : {}),
    ...(boundedCause !== undefined ? { errorCause: `${boundedCause}${suffix}` } : {}),
  };
}

function formatCause(cause: unknown, depth = 0): string | undefined {
  if (cause === undefined || depth > 5) return undefined;
  if (cause instanceof Error) {
    const nested = formatCause(cause.cause, depth + 1);
    return `${cause.name}: ${cause.message}${nested ? `; cause: ${nested}` : ""}`;
  }
  if (typeof cause === "string") return cause;
  try {
    return JSON.stringify(cause) ?? String(cause);
  } catch {
    return String(cause);
  }
}
