import type { Page, TestInfo } from '@playwright/test';

type InputRecord = {
  type: string;
  target: string;
  pointerId?: number;
  primary?: boolean;
  x?: number;
  y?: number;
  prevented: boolean;
};
type DiagnosticWindow = Window & { __harnessInput?: InputRecord[] };

export async function recordInput(page: Page) {
  await page.addInitScript(() => {
    const host = window as DiagnosticWindow;
    host.__harnessInput = [];
    for (const type of [
      'pointerdown',
      'pointerup',
      'pointercancel',
      'gotpointercapture',
      'lostpointercapture',
      'touchstart',
      'touchend',
      'click',
      'blur',
      'resize',
    ]) {
      window.addEventListener(
        type,
        (event) => {
          const element = event.target instanceof Element ? event.target : null;
          const pointer = event instanceof PointerEvent ? event : null;
          const record: InputRecord = {
            type,
            target: element
              ? `${element.tagName}.${element.getAttribute('class') ?? ''}[${element.getAttribute('aria-label') ?? ''}]`
              : 'window',
            pointerId: pointer?.pointerId,
            primary: pointer?.isPrimary,
            x: pointer?.clientX,
            y: pointer?.clientY,
            prevented: event.defaultPrevented,
          };
          host.__harnessInput?.push(record);
          queueMicrotask(() => (record.prevented = event.defaultPrevented));
          if (host.__harnessInput && host.__harnessInput.length > 100) host.__harnessInput.shift();
        },
        true,
      );
    }
  });
}

export async function attachFailedInput(page: Page, info: TestInfo) {
  if (info.status === info.expectedStatus || page.isClosed()) return;
  const events = await page.evaluate(() => (window as DiagnosticWindow).__harnessInput);
  if (events)
    await info.attach('pointer-input', {
      body: JSON.stringify(events, null, 2),
      contentType: 'application/json',
    });
}
