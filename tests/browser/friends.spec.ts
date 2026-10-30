import { unlockPhone } from '../helpers/unlock';
import { expect, test } from '@playwright/test';
import { launchHomeApp } from '../helpers/home';

const friends = [
  {
    id: 'akiyama',
    name: '아키야마 슌',
    search: '아키야마',
    width: 900,
    extension: 'jpg',
    reply: '이번에는 늦지 마라.',
    response: '하하, 벌써 못 믿으시는 겁니까? 알겠습니다.',
  },
  {
    id: 'ichiban',
    name: '카스가 이치반',
    search: '이치반',
    width: 114,
    extension: 'jpg',
    reply: '조금 있다 들르겠다. 무슨 일이지?',
    response: '자리 배치를 조금 바꿨거든요. 한 번만 봐주세요!',
  },
] as const;
for (const friend of friends) {
  for (const width of [360, 390, 430]) {
    test(`${friend.search} 연락처·전화·답장 저장 ${width}`, async ({ page }, info) => {
      await page.setViewportSize({
        width,
        height: width === 360 ? 800 : width === 390 ? 844 : 932,
      });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.clock.install();
      await page.goto('./');
      await unlockPhone(page);
      await launchHomeApp(page, 'contacts');
      await page.getByRole('searchbox', { name: '연락처 검색' }).fill(friend.search);
      await page.locator(`[data-contact=${friend.id}]`).tap();
      const portrait = page.getByRole('img', { name: `${friend.name} 프로필` });
      await expect(portrait).toHaveAttribute(
        'src',
        `/yaku_IPhone/story/${friend.id}.${friend.extension}`,
      );
      await expect
        .poll(() => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBe(friend.width);
      await page.getByRole('button', { name: `${friend.name}에게 메시지 보내기` }).tap();
      const thread = page.getByRole('log', { name: `${friend.name}와의 대화` });
      await expect(thread.locator('.message-bubble')).not.toHaveCount(0);
      await expect(page.getByRole('region', { name: '답장 선택' })).toHaveCount(0);
      await expect(page.locator('.message-story-reply')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`history-${friend.id}.png`) });
      await page.reload();
      await unlockPhone(page);
      await expect(page.getByLabel('읽지 않은 대화 7개')).toBeVisible();
      await launchHomeApp(page, 'phone');
      await page.getByRole('button', { name: '연락처', exact: true }).tap();
      await page.getByRole('searchbox', { name: '연락처 검색' }).fill(friend.search);
      await page.locator(`[data-contact=${friend.id}]`).tap();
      await page.getByRole('button', { name: `${friend.name}에게 메시지 보내기` }).tap();
      await expect(thread.locator('.message-bubble')).not.toHaveCount(0);
      await expect(
        page.getByRole('button', { name: `${friend.reply} 보내기`, exact: true }),
      ).toHaveCount(0);
    });
  }
}

test('기존 여섯 대화 상태를 보존하며 니시키를 제외하고 아키야마·이치반를 읽지 않음으로 표시한다', async ({
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
        readThreads: ['haruka', 'majima', 'daigo', 'saejima', 'mine', 'date', 'nishiki'],
        replies: ['date'],
        replySent: false,
        missedCall: false,
        missedCallRead: false,
        callStatus: null,
      }),
    ),
  );
  await page.reload();
  await unlockPhone(page);
  await expect(page.getByLabel('읽지 않은 대화 2개')).toBeVisible();
  await launchHomeApp(page, 'messages');
  await page.getByRole('button', { name: '읽지 않은 메시지만 보기' }).tap();
  await expect(page.locator('[data-conversation]')).toHaveCount(2);
  await page.locator('[data-conversation=akiyama]').tap();
  await page.keyboard.press('Alt+Home');
  await launchHomeApp(page, 'contacts');
  await expect(page.locator('[data-contact=nishiki]')).toHaveCount(0);
  await page.locator('[data-contact=ichiban]').tap();
  await page.getByRole('button', { name: '카스가 이치반에게 메시지 보내기' }).tap();
  await page.keyboard.press('Alt+Home');
  await expect(page.locator('[data-launch-app=messages] .home-badge')).toHaveCount(0);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('yaku-iphone.day.v1')!)),
  ).toMatchObject({
    ingredients: { potato: true },
    reminders: { garden: true },
    replies: ['date'],
    readThreads: ['haruka', 'majima', 'daigo', 'saejima', 'mine', 'date', 'akiyama', 'ichiban'],
  });
});
