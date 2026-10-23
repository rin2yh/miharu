import type { ProviderSnapshot } from "../../domain";
import type { ServiceConfig } from "../../shared/config/services";
import { fetchOpenAIChatGPTSnapshot } from "./openai/chatgpt";
import { fetchSlackSnapshot } from "./slack";
import { fetchStatuspageSnapshot } from "./statuspage";
import type { ProviderContext } from "./shared";

export async function fetchServiceSnapshot(
  service: ServiceConfig,
  context: ProviderContext,
): Promise<ProviderSnapshot> {
  if (service.provider === "slack")
    return fetchSlackSnapshot(service, context.signal, context.fetcher);
  if (service.provider === "openai-chatgpt") return fetchOpenAIChatGPTSnapshot(service, context);
  return fetchStatuspageSnapshot(service, context.signal, context.fetcher);
}
