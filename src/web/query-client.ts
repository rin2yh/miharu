import { QueryClient } from "@tanstack/react-query";

export function createQueryClient(options: { gcTime?: number } = {}) {
  return new QueryClient({
    defaultOptions: {
      queries: {
        ...(options.gcTime === undefined ? {} : { gcTime: options.gcTime }),
        refetchOnReconnect: false,
        refetchOnWindowFocus: true,
        retry: false,
      },
    },
  });
}

export const queryClient = createQueryClient();
