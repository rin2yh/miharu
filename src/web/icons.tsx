export function SearchIcon() {
  return (
    <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 5 5" />
    </svg>
  );
}

export function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={spinning ? "refresh-icon spinning" : "refresh-icon"}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M20 7v5h-5M4.5 10a7.5 7.5 0 0 1 13-3L20 12M4 17v-5h5m10.5 2a7.5 7.5 0 0 1-13 3L4 12" />
    </svg>
  );
}

export function ExternalIcon() {
  return (
    <svg className="external-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M9.5 2.5h4v4M13.25 2.75 7.5 8.5M12 8.5v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h4" />
    </svg>
  );
}

export function WarningIcon() {
  return (
    <svg className="warning-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2.5 18 17H2l8-14.5ZM10 7v4.5m0 2.5h.01" />
    </svg>
  );
}
