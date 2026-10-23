import type { ProviderSnapshot } from "../../domain";
import type { ServiceConfig } from "../../shared/config/services";
import type { ProviderContext } from "../provider-context";
import { fetchOpenAIChatGPTSnapshot } from "./openai/chatgpt";
import { fetchSlackSnapshot } from "./slack";
import { fetchStatuspageSnapshot } from "./statuspage";

type ProviderKind = ServiceConfig["provider"];
type ProviderService<Kind extends ProviderKind> = Extract<ServiceConfig, { provider: Kind }>;
type ProviderImplementation<Kind extends ProviderKind> = (
  service: ProviderService<Kind>,
  context: ProviderContext,
) => Promise<ProviderSnapshot>;
type ProviderImplementations = {
  [Kind in ProviderKind]: ProviderImplementation<Kind>;
};

const providerImplementations: ProviderImplementations = {
  slack: fetchSlackSnapshot,
  statuspage: fetchStatuspageSnapshot,
  "openai-chatgpt": fetchOpenAIChatGPTSnapshot,
};

function runProvider<Kind extends ProviderKind>(
  kind: Kind,
  service: ProviderService<Kind>,
  context: ProviderContext,
): Promise<ProviderSnapshot> {
  return providerImplementations[kind](service, context);
}

export function fetchServiceSnapshot(
  service: ServiceConfig,
  context: ProviderContext,
): Promise<ProviderSnapshot> {
  return runProvider(service.provider, service, context);
}
