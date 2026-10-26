export function AppBrand() {
  return (
    <a
      className="inline-flex items-center gap-2.5 text-base font-bold tracking-tight text-ink no-underline"
      href="/"
      aria-label="miharu ホーム"
    >
      <span
        className="flex h-5 w-5 items-end gap-0.5 rounded-md bg-forest px-1 py-1"
        aria-hidden="true"
      >
        <span className="block h-1.5 flex-1 rounded-t-xs bg-green-100" />
        <span className="block h-2.5 flex-1 rounded-t-xs bg-green-100" />
        <span className="block h-2 flex-1 rounded-t-xs bg-green-100" />
      </span>
      <span>miharu</span>
    </a>
  );
}
