import { describe, expect, it } from 'vitest';
import { getDisplayDate } from './date';

describe('한국 기준 표시 날짜', () => {
  it('고정 장면의 한국어 날짜와 ISO 날짜를 만든다', () => {
    expect(getDisplayDate(new Date('2026-10-23T00:41:00Z'))).toEqual({
      label: '10월 23일 금요일',
      isoDate: '2026-10-23',
    });
  });
  it('UTC 날짜가 바뀌기 전 한국의 자정을 반영한다', () => {
    expect(getDisplayDate(new Date('2026-12-31T14:59:59Z')).isoDate).toBe('2026-12-31');
    expect(getDisplayDate(new Date('2026-12-31T15:00:00Z'))).toEqual({
      label: '1월 1일 금요일',
      isoDate: '2027-01-01',
    });
  });
});
