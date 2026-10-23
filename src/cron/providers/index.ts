import type { ProviderSnapshot } from "../../domain";
import type { ServiceConfig } from "../../shared/config/services";
import type { ProviderContext } from "../provider-context";
import { fetchOpenAIChatGPTSnapshot } from "./openai/chatgpt";
import { fetchSlackSnapshot } from "./slack";
import { fetchStatuspageSnapshot } from "./statuspage";

export async function fetchServiceSnapshot(
  service: ServiceConfig,
  context: ProviderContext,
): Promise<ProviderSnapshot> {
  if (service.provider === "slack")
    return fetchSlackSnapshot(service, context.signal, context.fetcher);
  if (service.provider === "openai-chatgpt") return fetchOpenAIChatGPTSnapshot(service, context);
  return fetchStatuspageSnapshot(service, context.signal, context.fetcher);
}
