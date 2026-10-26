import type { ProviderSnapshot } from "../domain";
import type { ServiceConfig } from "../shared/config/services";
import type { ProviderContext } from "../cron/provider-context";
import { fetchGoogleWorkspaceSnapshot } from "./google-workspace";
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
  "google-workspace": fetchGoogleWorkspaceSnapshot,
};

export function fetchServiceSnapshot<Kind extends ProviderKind>(
  service: ProviderService<Kind>,
  context: ProviderContext,
): Promise<ProviderSnapshot> {
  return providerImplementations[service.provider](service, context);
}
