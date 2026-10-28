export interface ErrorDiagnostics {
  errorType: string;
  errorMessage?: string;
  errorCause?: string;
}

export function getErrorDiagnostics(error: unknown): ErrorDiagnostics {
  if (error instanceof Error) {
    const cause = formatCause(error.cause);
    return {
      errorType: /^[A-Za-z][\w.]{0,63}$/.test(error.name) ? error.name : "Error",
      errorMessage: error.message,
      ...(cause ? { errorCause: cause } : {}),
    };
  }
  return {
    errorType: "UnknownError",
    ...(error === undefined ? {} : { errorMessage: formatCause(error) }),
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
