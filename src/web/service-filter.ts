import { SERVICES } from "../shared/config/services";

export function getSelectedServiceIds(search: string): string[] {
  const params = new URLSearchParams(search);
  if (!params.has("services")) return SERVICES.map((service) => service.id);

  const requestedIds = new Set((params.get("services") ?? "").split(","));
  return SERVICES.filter((service) => requestedIds.has(service.id)).map((service) => service.id);
}

export function getServiceSelectionUrl(currentUrl: string, selectedIds: Iterable<string>): string {
  const url = new URL(currentUrl);
  const selected = new Set(selectedIds);
  const validIds = SERVICES.filter((service) => selected.has(service.id)).map(
    (service) => service.id,
  );

  if (validIds.length === SERVICES.length) {
    url.searchParams.delete("services");
  } else {
    url.searchParams.set("services", validIds.join(","));
  }

  return url.toString();
}
