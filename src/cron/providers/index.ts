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
type ProviderRegistration<Kind extends ProviderKind> = {
  provider: Kind;
  run: (service: ServiceConfig, context: ProviderContext) => Promise<ProviderSnapshot>;
};
type ProviderRegistrationMap = {
  [Kind in ProviderKind]: ProviderRegistration<Kind>;
};

function hasProvider<Kind extends ProviderKind>(
  service: ServiceConfig,
  kind: Kind,
): service is ProviderService<Kind> {
  return service.provider === kind;
}

function registerProvider<Kind extends ProviderKind>(
  kind: Kind,
  implementation: ProviderImplementation<Kind>,
): ProviderRegistration<Kind> {
  return {
    provider: kind,
    run(service, context) {
      if (!hasProvider(service, kind)) {
        throw new Error(
          `Provider registration mismatch: expected ${kind}, received ${service.provider}`,
        );
      }
      return implementation(service, context);
    },
  };
}

const providerImplementations = {
  slack: registerProvider("slack", fetchSlackSnapshot),
  statuspage: registerProvider("statuspage", fetchStatuspageSnapshot),
  "openai-chatgpt": registerProvider("openai-chatgpt", fetchOpenAIChatGPTSnapshot),
} satisfies ProviderRegistrationMap;

export function fetchServiceSnapshot(
  service: ServiceConfig,
  context: ProviderContext,
): Promise<ProviderSnapshot> {
  return providerImplementations[service.provider].run(service, context);
}
