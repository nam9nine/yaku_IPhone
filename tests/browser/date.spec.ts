import { unlockPhone } from '../helpers/unlock';
import { expect, test } from '../helpers/browser-test';
import { launchHomeApp } from '../helpers/home';

for (const width of [360, 390, 430]) {
  test(`다테 연락처의 과거 대화와 읽음 상태를 재접속 후에도 보존한다 ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 360 ? 800 : width === 390 ? 844 : 932 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.install();
    await page.goto('./');
    await unlockPhone(page);
    await expect(page.getByLabel('읽지 않은 대화 8개')).toBeVisible();
    await launchHomeApp(page, 'contacts');
    await page.getByRole('searchbox', { name: '연락처 검색' }).fill('다테 씨');
    await page.locator('[data-contact=date]').tap();
    const portrait = page.getByRole('img', { name: '다테 마코토 프로필' });
    await expect(portrait).toBeVisible();
    await expect(portrait).toHaveAttribute('src', '/yaku_IPhone/story/date.jpg');
    await expect
      .poll(() => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBe(900);
    await page.getByRole('button', { name: '다테 마코토에게 메시지 보내기' }).tap();
    const thread = page.getByRole('log', { name: '다테 마코토와의 대화' });
    await expect(thread).toContainText(
      '키류, 문자 봤으면 연락 좀 해. 또 혼자 무슨 일 벌이는 건 아니지?',
    );
    const reply = '별일 없습니다, 다테 씨. 걱정 끼쳐서 죄송합니다.';
    await expect(thread.getByText(reply, { exact: true })).toHaveCount(1);
    await expect(thread).toContainText('맡아뒀던 네 물건, 봉투에 넣어 보냈다. 받으면 연락해.');
    await expect(page.locator('.message-story-reply')).toHaveCount(0);
    await expect(page.locator('.message-ai-input')).toHaveCount(0);
    const before = await thread.locator('.message-bubble').allTextContents();
    await page.clock.runFor(12_000);
    expect(await thread.locator('.message-bubble').allTextContents()).toEqual(before);
    await page.reload();
    await unlockPhone(page);
    await expect(page.getByLabel('읽지 않은 대화 7개')).toBeVisible();
    await launchHomeApp(page, 'phone');
    await page.getByRole('button', { name: '연락처', exact: true }).tap();
    await page.locator('[data-contact=date]').tap();
    await page.getByRole('button', { name: '다테 마코토에게 메시지 보내기' }).tap();
    await expect(thread.getByText(reply, { exact: true })).toHaveCount(1);
    expect(await thread.locator('.message-bubble').allTextContents()).toEqual(before);
    await expect(page.locator('.message-story-reply')).toHaveCount(0);
    await expect(page.locator('.message-ai-input')).toHaveCount(0);
  });
}

test('기존 다섯 대화를 읽은 저장 상태에서 다테·아키야마·이치반을 새 대화로 표시한다', async ({
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
  await expect(page.getByRole('button', { name: '남은 할 일 4개', exact: true })).toBeVisible();
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
