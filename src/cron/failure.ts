export interface FailureMetadata {
  lastCheckedAt: string;
  lastErrorAt: string;
  errorCode: string;
}

export function failureMetadata(observedAt: string, errorCode: string): FailureMetadata {
  return {
    lastCheckedAt: observedAt,
    lastErrorAt: observedAt,
    errorCode,
  };
}

export function applyFailureMetadata<T extends object>(
  previous: T,
  failure: FailureMetadata,
): T & FailureMetadata {
  return { ...previous, ...failure };
}
