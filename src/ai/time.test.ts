import { expect, it } from 'vitest';
import { aiDate, aiTime } from './time';

it('서버의 UTC 시간을 한국 시간으로 표시한다', () => {
  expect(aiTime('2026-10-24T16:30:00+00:00')).toBe('01:30');
  expect(aiDate('2026-10-24T16:30:00Z')).toBe('10월 25일 일요일');
  expect(aiTime('2026-10-24T15:00:00Z')).toBe('00:00');
  expect(aiTime('16:40')).toBe('16:40');
  expect(aiTime('invalid')).toBe('');
  expect(aiDate('invalid')).toBe('');
});
