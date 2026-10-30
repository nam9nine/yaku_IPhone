import { expect, test } from '../helpers/browser-test';
import { mockStoryAi } from '../helpers/mock-story-ai';
import { unlockPhone } from '../helpers/unlock';
import { launchHomeApp } from '../helpers/home';
import { settleAiRequests } from '../helpers/ai-clock';

for (const reason of ['idle', 'declined', 'missed'] as const) {
  test(`${reason}: 전화 이벤트만 접수하고 지연 없이 AI 문자 하나를 표시한다`, async ({
    page,
  }, info) => {
    await mockStoryAi(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const followups: Record<string, unknown>[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/v1/call-followups')
        followups.push(request.postDataJSON());
    });
    await page.goto('./');
    await unlockPhone(page);
    if (reason === 'idle') {
      await launchHomeApp(page, 'phone');
      await page.getByRole('button', { name: '연락처', exact: true }).tap();
      await page.locator('[data-contact=majima]').tap();
      await page.getByRole('button', { name: '마지마 고로에게 전화 걸기', exact: true }).tap();
      await page.clock.runFor(3000);
      const call = page.getByRole('dialog', { name: '마지마 형님 통화', exact: true });
      await expect(call).toBeVisible();
      await expect(call.getByRole('status')).toHaveText('');
      await settleAiRequests(page);
      await page.clock.runFor(59_000);
      await expect(call).toBeVisible();
      expect(followups).toHaveLength(0);
      await page.clock.runFor(8_000);
      await expect(call).toHaveCount(0);
    } else {
      await launchHomeApp(page, 'notes');
      await page.locator('[data-note-id=curry]').tap();
      for (const item of ['감자', '양파', '고기', '카레'])
        await page.getByRole('checkbox', { name: `${item} 완료`, exact: true }).check();
      await expect(page.getByRole('button', { name: '전화 응답', exact: true })).toBeVisible();
      if (reason === 'declined')
        await page.getByRole('button', { name: '전화 거절', exact: true }).tap();
      else await page.clock.runFor(45_000);
    }
    await expect.poll(() => followups.length).toBe(1);
    expect(followups[0]).toMatchObject({ character: 'majima', reason });
    expect(followups[0]).not.toHaveProperty('message');
    await settleAiRequests(page);
    await page.keyboard.press('Alt+Home');
    await launchHomeApp(page, 'messages');
    await page.locator('[data-conversation=majima]').tap();
    const log = page.getByRole('log', { name: '마지마 고로와의 대화' });
    await expect(log.getByText('검증용 마지마 전화 후속 문자', { exact: true })).toHaveCount(1);
    await expect(page.locator('.typing-bubble')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`${reason}-followup.png`) });
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('yaku-iphone.day.v1')!).pendingCallFollowups,
      ),
    ).toEqual([]);
    await page.reload();
    await unlockPhone(page);
    await launchHomeApp(page, 'messages');
    await page.locator('[data-conversation=majima]').tap();
    await expect(log.getByText('검증용 마지마 전화 후속 문자', { exact: true })).toHaveCount(1);
    expect(followups).toHaveLength(1);
  });
}
