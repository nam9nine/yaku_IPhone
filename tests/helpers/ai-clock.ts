import { expect, type Page } from '@playwright/test';
import { AI_PRESENTATION_KEY } from '../../src/ai/presentation';
import { AI_ENDPOINT } from '../../src/ai/config';

const installed = new WeakSet<Page>();
const inFlight = new WeakMap<Page, Set<string>>();
export async function installAiClock(page: Page) {
  if (installed.has(page)) return;
  installed.add(page);
  const pending = new Set<string>();
  inFlight.set(page, pending);
  page.on('request', (request) => {
    if (request.url().startsWith(AI_ENDPOINT)) pending.add(request.url());
  });
  page.on('requestfinished', (request) => pending.delete(request.url()));
  page.on('requestfailed', (request) => pending.delete(request.url()));
  await page.clock.install();
}

/** Advance actual presentation deadlines; never shorten production timing or bypass inference. */
export async function finishAiReply(page: Page, character: 'haruka' | 'majima') {
  await expect
    .poll(async () =>
      page.evaluate(
        ({ key, character }) => {
          try {
            const receipt = JSON.parse(localStorage.getItem(key) ?? 'null')
              ?.receipts?.filter((r: { character: string }) => r.character === character)
              .at(-1);
            return !!receipt?.replyId;
          } catch {
            return 'storage-unavailable';
          }
        },
        { key: AI_PRESENTATION_KEY, character },
      ),
    )
    .not.toBe(false);
  await settleAiRequests(page);
  const remaining = await page.evaluate(
    ({ key, character }) => {
      try {
        const receipt = JSON.parse(localStorage.getItem(key) ?? 'null')
          ?.receipts?.filter((r: { character: string }) => r.character === character)
          .at(-1);
        return Math.max(0, receipt.deliverAt - Date.now());
      } catch {
        return 22_000;
      }
    },
    { key: AI_PRESENTATION_KEY, character },
  );
  await page.clock.fastForward(remaining + 1);
}

export async function showAiTyping(page: Page, character: 'haruka' | 'majima') {
  await settleAiRequests(page);
  const remaining = await page.evaluate(
    ({ key, character }) => {
      const receipt = JSON.parse(localStorage.getItem(key) ?? 'null')
        ?.receipts?.filter((r: { character: string }) => r.character === character)
        .at(-1);
      return Math.max(0, receipt.typingAt - Date.now());
    },
    { key: AI_PRESENTATION_KEY, character },
  );
  await page.clock.fastForward(remaining + 1);
}

export async function settleAiRequests(page: Page) {
  await expect.poll(() => inFlight.get(page)?.size ?? 0).toBe(0);
  // Let the completed fetch and React subscribers commit before jumping timers.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
