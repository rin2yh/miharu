import type { ProviderSnapshot } from "../../domain";
import type { ServiceConfig } from "../../shared/config/services";
import type { ProviderContext } from "../provider-context";
import { fetchOpenAIChatGPTSnapshot } from "./openai/chatgpt";
import { fetchSlackSnapshot } from "./slack";
import { fetchStatuspageSnapshot } from "./statuspage";

type ProviderImplementation = (
  service: ServiceConfig,
  context: ProviderContext,
) => Promise<ProviderSnapshot>;

const providerImplementations = {
  slack: fetchSlackSnapshot,
  statuspage: fetchStatuspageSnapshot,
  "openai-chatgpt": fetchOpenAIChatGPTSnapshot,
} satisfies Record<ServiceConfig["provider"], ProviderImplementation>;

export function fetchServiceSnapshot(
  service: ServiceConfig,
  context: ProviderContext,
): Promise<ProviderSnapshot> {
  return providerImplementations[service.provider](service, context);
}
