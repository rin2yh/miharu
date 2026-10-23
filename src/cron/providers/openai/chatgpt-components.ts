import { normalizeStatus, type NormalizedComponent, type NormalizedStatus } from "../../../domain";
import { COMPONENTS_PER_SERVICE_LIMIT, type ServiceConfig } from "../../../shared/config/services";
import { asRecord, boundedText, ProviderError, requiredText } from "../shared";

export type OpenAIChatGPTService = Extract<ServiceConfig, { provider: "openai-chatgpt" }>;

interface ChatGPTComponentSnapshot {
  components: NormalizedComponent[];
  status: NormalizedStatus;
  sourceStatus: string;
}

const statusPriority: Record<NormalizedStatus, number> = {
  unknown: -1,
  operational: 0,
  under_maintenance: 1,
  degraded_performance: 2,
  partial_outage: 3,
  major_outage: 4,
};

export function parseChatGPTComponents(
  service: OpenAIChatGPTService,
  values: unknown[],
): ChatGPTComponentSnapshot {
  if (values.length > COMPONENTS_PER_SERVICE_LIMIT) {
    throw new ProviderError(
      "invalid_payload",
      "OpenAI component list exceeded the supported limit",
    );
  }

  const expectedComponents = new Map(
    service.components.map((component) => [component.id, component]),
  );
  const componentsById = new Map<string, NormalizedComponent>();
  for (const value of values) {
    const row = asRecord(value);
    const id = boundedText(row?.id, 200);
    if (!id || !expectedComponents.has(id)) continue;
    const sourceStatus = requiredText(row?.status, "component status", 100);
    componentsById.set(id, {
      id,
      name: requiredText(row?.name, "component name", 100),
      status: normalizeStatus(sourceStatus),
      sourceStatus,
    });
  }
  if (componentsById.size === 0) {
    throw new ProviderError("invalid_payload", "OpenAI ChatGPT components were not found");
  }

  const components = service.components.map(
    ({ id, name }) =>
      componentsById.get(id) ?? {
        id,
        name,
        status: "unknown" as const,
        sourceStatus: "missing",
      },
  );
  const missingComponents = components.some((component) => component.sourceStatus === "missing");
  const hasUnknownComponent = components.some((component) => component.status === "unknown");
  const overall = components.toSorted(
    (left, right) => statusPriority[right.status] - statusPriority[left.status],
  )[0]!;

  return {
    components,
    status: missingComponents || hasUnknownComponent ? "unknown" : overall.status,
    sourceStatus: missingComponents
      ? "incomplete_components"
      : hasUnknownComponent
        ? "unknown"
        : overall.sourceStatus,
  };
}
