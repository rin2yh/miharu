import { useId } from "react";
import { SearchIcon } from "./icons";

type ServiceSearchProps = {
  query: string;
  onChange: (query: string) => void;
  ariaLabel?: string;
  clearLabel?: string;
};

export function ServiceSearch({
  query,
  onChange,
  ariaLabel = "サービスを検索",
  clearLabel = "検索をクリア",
}: ServiceSearchProps) {
  const inputId = useId();

  return (
    <label className="flex h-10 w-full min-w-0 items-center rounded-md border border-line-strong bg-surface px-2.5 text-muted focus-within:border-healthy focus-within:ring-2 focus-within:ring-healthy/20">
      <SearchIcon />
      <input
        className="w-full min-w-0 border-0 bg-transparent px-2 text-xs text-ink placeholder:text-placeholder focus-visible:outline-hidden [&::-webkit-search-cancel-button]:hidden"
        id={inputId}
        name="service"
        type="search"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        placeholder="サービスを検索"
        aria-label={ariaLabel}
      />
      {query && (
        <button
          className="grid h-6 w-6 shrink-0 place-items-center rounded-sm border-0 bg-transparent p-0 text-lg leading-none text-muted hover:bg-control-hover"
          type="button"
          aria-label={clearLabel}
          onClick={() => onChange("")}
        >
          ×
        </button>
      )}
    </label>
  );
}
