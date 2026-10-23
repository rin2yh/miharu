import { normalizeStatus, type NormalizedComponent } from "../../domain";
import { COMPONENTS_PER_SERVICE_LIMIT, type ServiceConfig } from "../../shared/config/services";
import { asRecord, ProviderError, requiredText } from "./shared";

type StatusPageService = Extract<ServiceConfig, { provider: "statuspage" }>;

export function parseStatuspageComponents(
  components: unknown[],
  service: StatusPageService,
): NormalizedComponent[] {
  const selected = selectStatuspageComponents(components, service.componentGroupId);
  if (selected.length > COMPONENTS_PER_SERVICE_LIMIT) {
    throw new ProviderError(
      "invalid_payload",
      "Statuspage component list exceeded the supported limit",
    );
  }
  return selected.map(parseStatuspageComponent);
}

function selectStatuspageComponents(components: unknown[], groupId?: string): unknown[] {
  if (!groupId) return components;

  const group = components
    .map((component) => asRecord(component))
    .find((component) => component?.id === groupId && component.group === true);
  const memberIds = Array.isArray(group?.components)
    ? group.components.filter((id): id is string => typeof id === "string")
    : [];

  if (!group || memberIds.length === 0) {
    throw new ProviderError("invalid_payload", "Configured Statuspage component group is missing");
  }

  const members = new Set(memberIds);
  const selected = components.filter((component) => {
    const row = asRecord(component);
    return (
      row !== null &&
      row.group !== true &&
      row.group_id === groupId &&
      typeof row.id === "string" &&
      members.has(row.id)
    );
  });

  // An incomplete success would make store synchronization delete omitted components.
  if (selected.length === 0 || selected.length !== memberIds.length) {
    throw new ProviderError(
      "invalid_payload",
      "Configured Statuspage component group is empty or incomplete",
    );
  }
  return selected;
}

function parseStatuspageComponent(value: unknown): NormalizedComponent {
  const row = asRecord(value);
  if (!row) throw new ProviderError("invalid_payload", "Invalid Statuspage component");
  const sourceStatus = requiredText(row.status, "component status", 100);
  return {
    id: requiredText(row.id, "component id", 200),
    name: requiredText(row.name, "component name", 100),
    status: normalizeStatus(sourceStatus),
    sourceStatus,
  };
}
