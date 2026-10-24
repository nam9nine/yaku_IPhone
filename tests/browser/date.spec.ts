import { unlockPhone } from '../helpers/unlock';
import { expect, test } from '@playwright/test';
import { launchHomeApp } from '../helpers/home';

for (const width of [360, 390, 430]) {
  test(`다테 연락처에서 메시지 답장과 재접속 상태가 이어진다 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 360 ? 800 : width === 390 ? 844 : 932 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./');
    await unlockPhone(page);
    await expect(page.getByLabel('읽지 않은 대화 8개')).toBeVisible();
    await launchHomeApp(page, 'contacts');
    await page.getByRole('searchbox', { name: '연락처 검색' }).fill('다테 형사');
    await page.locator('[data-contact=date]').tap();
    const portrait = page.getByRole('img', { name: '다테 마코토 프로필' });
    await expect(portrait).toBeVisible();
    await expect(portrait).toHaveAttribute('src', '/yaku_IPhone/story/date.jpg');
    await expect
      .poll(() => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBe(900);
    await page.getByRole('button', { name: '다테 마코토에게 메시지 보내기' }).tap();
    const thread = page.getByRole('log', { name: '다테 마코토와의 대화' });
    await expect(thread).toContainText('키류, 아이들은 잘 지내나?');
    const reply = '다들 잘 지냅니다. 다음에 오시면 같이 식사하시죠.';
    await page.getByRole('button', { name: `${reply} 보내기`, exact: true }).tap();
    await expect(thread.getByText(reply, { exact: true })).toHaveCount(1);
    await expect(thread).toContainText('좋지. 하루카한테도 안부 전해 줘.');
    await page.reload();
    await unlockPhone(page);
    await expect(page.getByLabel('읽지 않은 대화 7개')).toBeVisible();
    await launchHomeApp(page, 'phone');
    await page.getByRole('button', { name: '연락처', exact: true }).tap();
    await page.locator('[data-contact=date]').tap();
    await page.getByRole('button', { name: '다테 마코토에게 메시지 보내기' }).tap();
    await expect(thread.getByText(reply, { exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: `${reply} 보내기`, exact: true })).toHaveCount(0);
  });
}

test('기존 다섯 대화를 읽은 저장 상태에서 다테와 두 친구를 새 대화로 표시한다', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await page.evaluate(() =>
    localStorage.setItem(
      'yaku-iphone.day.v1',
      JSON.stringify({
        ingredients: { potato: true, onion: false, meat: false, curry: false },
        reminders: { garden: true, mame: false },
        readThreads: ['haruka', 'majima', 'daigo', 'saejima', 'mine'],
        replies: ['majima'],
        replySent: false,
        missedCall: false,
        missedCallRead: false,
        callStatus: null,
      }),
    ),
  );
  await page.reload();
  await expect(page.getByRole('button', { name: '남은 할 일 2개', exact: true })).toBeVisible();
  await unlockPhone(page);
  await expect(page.getByLabel('읽지 않은 대화 3개')).toBeVisible();
  await launchHomeApp(page, 'messages');
  await page.getByRole('button', { name: '읽지 않은 메시지만 보기' }).tap();
  await expect(page.locator('[data-conversation]')).toHaveCount(3);
  await page.locator('[data-conversation=date]').tap();
  await page.keyboard.press('Alt+Home');
  await expect(page.getByLabel('읽지 않은 대화 2개')).toBeVisible();
  await launchHomeApp(page, 'notes');
  await page.locator('[data-note-id=curry]').tap();
  await expect(page.getByRole('checkbox', { name: '감자 완료', exact: true })).toBeChecked();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('yaku-iphone.day.v1')!)),
  ).toMatchObject({
    replies: ['majima'],
    reminders: { garden: true, mame: false },
    readThreads: ['haruka', 'majima', 'daigo', 'saejima', 'mine', 'date'],
  });
});
