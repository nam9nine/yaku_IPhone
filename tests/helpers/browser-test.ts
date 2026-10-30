import { test as base, type Route } from '@playwright/test';
import { AI_ENDPOINT } from '../../src/ai/config';

export * from '@playwright/test';

// Automatic capability checks must not contact the production Mac from local/CI UI tests.
// Later explicit page/context routes still own ON, loading, error, and chat scenarios.
export const test = base.extend<{ offlineEpisodeCapability: void }>({
  offlineEpisodeCapability: [
    async ({ context }, use) => {
      const url = `${AI_ENDPOINT}/v1/health`;
      const handler = async (route: Route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        await route.fulfill({
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ status: 'ready', episode_protocol: 1, episodes_enabled: false }),
        });
      };
      await context.route(url, handler);
      await use();
      await context.unroute(url, handler);
    },
    { auto: true },
  ],
});
