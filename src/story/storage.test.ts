import { afterEach, expect, it, vi } from 'vitest';
import { readStory } from './useStoredState';
afterEach(() => vi.unstubAllGlobals());
const valid = (value: unknown) => Array.isArray(value) && value.every((x) => typeof x === 'string');
it('스토리 저장은 전용 버전 키만 읽고 형식을 검사한다', () => {
  const getItem = vi.fn(() => '["saved"]');
  vi.stubGlobal('localStorage', { getItem });
  expect(readStory('notes', ['initial'], valid)).toEqual(['saved']);
  expect(getItem).toHaveBeenCalledWith('yaku-iphone.story.notes.v1');
});
it('손상되거나 거부된 저장소는 기본값으로 복구한다', () => {
  for (const raw of ['null', '{', '[1]', '{"unexpected":true}']) {
    vi.stubGlobal('localStorage', { getItem: () => raw });
    expect(readStory('notes', ['initial'], valid)).toEqual(['initial']);
  }
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('denied');
    },
  });
  expect(readStory('notes', ['initial'], valid)).toEqual(['initial']);
});
