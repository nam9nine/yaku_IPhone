import { describe, expect, it } from 'vitest';
import {
  cleanKorean,
  findCharacterMentions,
  normalizeRecord,
  parseSourceKey,
} from '../scripts/lib/yakuza-normalize.mjs';

// All sentences and source locations here are synthetic, not game excerpts.
const options = {
  gameId: 'yakuza-test',
  sourcePath: 'fixtures/dialogue.jsonl.gz',
  sourceRevision: 'a'.repeat(40),
  lineNumber: 1,
};
const record = (scene = 'synthetic_scene') => ({
  ko_text: '내일 다시 얘기하자.',
  ja_text: 'また明日。',
  en_text: 'Talk tomorrow.',
  cht_text: '明天再談。',
  zh_text: '',
  扩展字段: JSON.stringify({
    k: `msg_replacer.bin.json@9@middle_file/auth/event/${scene}@table@7@synthetic@message`,
  }),
  是否重复: true,
  低质量段落数: 100,
});

describe('source-key recovery', () => {
  it('keeps numeric table locations distinct from corpus line numbers and embedded @ text', () => {
    const rawKey =
      'msg_replacer.bin.json@8@middle_file/auth/event/test@table@42@text@with\n<Action:Jump@UI>@message';
    expect(parseSourceKey(rawKey)).toEqual({
      container: 'msg_replacer.bin.json',
      sceneCandidate: 'middle_file/auth/event/test',
      tablePosition: 42,
      parseStatus: 'parsed',
    });
  });

  it('recognizes a flat subtitle locator without claiming a verified scene order', () => {
    expect(parseSourceKey('sound_auth_subtitles_speech_list_test.bin.json@17@@4')).toEqual({
      container: 'sound_auth_subtitles_speech_list_test.bin.json',
      sceneCandidate: 'sound_auth_subtitles_speech_list_test.bin.json',
      tablePosition: 17,
      parseStatus: 'parsed',
    });
    expect(parseSourceKey('item.bin.json@3@synthetic_item@name').sceneCandidate).toBeNull();
  });

  it('does not salvage malformed nested paths as a flat numeric index', () => {
    expect(parseSourceKey('msg.bin.json@1@scene@table@oops@text@message').parseStatus).toBe(
      'partial',
    );
    expect(parseSourceKey('not-a-source-key').parseStatus).toBe('invalid');
    expect(parseSourceKey(null).parseStatus).toBe('missing');
    expect(parseSourceKey('msg.bin.json@999999999999999999@name@message').parseStatus).toBe(
      'partial',
    );
  });
});

describe('conservative Korean cleaning', () => {
  it('preserves line boundaries, original spellings, and raw text while normalizing encoding', () => {
    const raw = `${'가'.normalize('NFD')}…\r\n그랬나?\r다시 보자.`;
    const cleaned = cleanKorean(raw);
    expect(cleaned.raw).toBe(raw);
    expect(cleaned.clean).toBe('가…\n그랬나?\n다시 보자.');
    expect(cleaned.changes).toEqual(['unicode_nfc', 'line_endings_lf']);
  });

  it('removes known presentation controls but preserves ordinary and unknown bracket text', () => {
    const raw =
      '<Color:255,255,0,255>약속<Color:Default><Action:Button_Circle@UI> <캬바> <Emotion:quiet>';
    const result = cleanKorean(raw);
    expect(result.clean).toBe('약속 <캬바> <Emotion:quiet>');
    expect(result.warnings).toContain('unrecognized_angle_tag');
    expect(result.changes).toEqual(['removed_color_controls', 'removed_action_controls']);
    expect(cleanKorean('<Color:999>남겨 둔다').clean).toBe('<Color:999>남겨 둔다');
  });

  it('retains unresolved variables and control bytes for review without inventing values', () => {
    const result = cleanKorean('약속까지 ${hour}시간\n남음\u0000');
    expect(result.clean).toContain('${hour}');
    expect(result.warnings).toEqual([
      'unresolved_template_variable',
      'unexpected_control_character',
    ]);
  });
});

describe('record preservation and review gates', () => {
  it('keeps Chinese-derived duplicate and quality flags without removing Korean records', () => {
    const source = record();
    const normalized = normalizeRecord(source, options);
    expect(normalized.korean.clean).toBe(source.ko_text);
    expect(normalized.upstreamMetadata['是否重复']).toBe(true);
    expect(normalized.upstreamMetadata['低质量段落数']).toBe(100);
    expect(normalized.review.trainingEligible).toBe(false);
    expect(normalized.review.speaker).toBeNull();
    expect(normalized.review.orderStatus).toBe('unverified');
    expect(source).toEqual(record());
  });

  it('preserves every source language and unknown metadata, including malformed language values', () => {
    const source = { ...record(), fr_text: 'Demain.', extra: { note: 'retained' }, ru_text: 123 };
    const normalized = normalizeRecord(source, options);
    expect(normalized.languages).toMatchObject({
      ko: source.ko_text,
      ja: source.ja_text,
      fr: 'Demain.',
      zh: '',
    });
    expect(normalized.upstreamMetadata.ru_text).toBe(123);
    expect(normalized.review.holdReasons).toContain('non_string_language:ru');
    normalized.upstreamMetadata.extra.note = 'changed output only';
    expect(source.extra.note).toBe('retained');
  });

  it('retains the same short utterance in different scenes and at distinct source locations', () => {
    const first = normalizeRecord(record('first_scene'), options);
    const second = normalizeRecord(record('second_scene'), options);
    const repeated = normalizeRecord(record('first_scene'), { ...options, lineNumber: 2 });
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.id).not.toBe(second.id);
    expect(first.sceneGroup).not.toBe(second.sceneGroup);
    expect(first.id).not.toBe(repeated.id);
    expect(first.sceneGroup).toBe(repeated.sceneGroup);
  });

  it('keeps equal path labels in different source containers separate', () => {
    const first = record('shared_label');
    const second = {
      ...first,
      扩展字段: first['扩展字段'].replace('msg_replacer.bin.json', 'other.bin.json'),
    };
    expect(normalizeRecord(first, options).sceneGroup).not.toBe(
      normalizeRecord(second, options).sceneGroup,
    );
    expect(normalizeRecord(first, options).review.storyGame).toBeNull();
    expect(normalizeRecord(first, options).review.timeline).toBeNull();
  });

  it('preserves an upstream replacement character and quarantines it for inspection', () => {
    const text = '손상된 합성 문장 \uFFFD';
    expect(cleanKorean(text).clean).toBe(text);
    expect(cleanKorean(text).warnings).toContain('replacement_character');
  });

  it('retains malformed metadata and unknown source material on hold', () => {
    const source = { ...record(), 扩展字段: '{invalid', ko_text: '' };
    const result = normalizeRecord(source, options);
    expect(result.upstreamMetadata['扩展字段']).toBe('{invalid');
    expect(result.classification.kind).toBe('unknown');
    expect(result.review.holdReasons).toContain('invalid_extension_json');
    expect(result.review.holdReasons).toContain('missing_korean');
    expect(result.source.rawRowHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('preserves object-shaped language values and unusual metadata keys without treating them as text', () => {
    const source = JSON.parse('{"ko_text":{"value":"unverified"},"__proto__":{"retained":true}}');
    const result = normalizeRecord(source, options);
    expect(result.languages).toEqual({});
    expect(result.upstreamMetadata.ko_text).toEqual({ value: 'unverified' });
    expect(Object.hasOwn(result.upstreamMetadata, '__proto__')).toBe(true);
    expect(result.upstreamMetadata.__proto__).toEqual({ retained: true });
    expect(result.review.holdReasons).toContain('non_string_language:ko');
    expect(result.review.holdReasons).toContain('missing_korean');
  });

  it.each([
    ['mail.bin.json@1@synthetic@body', 'mail_candidate'],
    [
      'msg_replacer.bin.json@1@middle_file/auth/event/test@table@2@hello@message',
      'dialogue_candidate',
    ],
    ['msg.bin.json@1@minigame@table@2@hello@message', 'ui_candidate'],
    ['item.bin.json@3@synthetic@name', 'name_candidate'],
    ['talk_talker.bin.json@3@synthetic@talk_talker', 'name_candidate'],
    ['auth.bin.json@3@synthetic@subtitle', 'dialogue_candidate'],
    ['talk.bin.json@3@synthetic@text', 'dialogue_candidate'],
    ['sound_auth_subtitles_speech_list_test.bin.json@3@@4', 'dialogue_candidate'],
    ['unrelated_sound_auth.bin.json@3@synthetic@text', 'unknown'],
    ['unknown.bin.json@3@mail@message', 'unknown'],
  ])('classifies source paths conservatively: %s', (key, kind) => {
    const result = normalizeRecord({ ...record(), 扩展字段: JSON.stringify({ k: key }) }, options);
    expect(result.classification.kind).toBe(kind);
    expect(result.review.trainingEligible).toBe(false);
  });

  it('rejects non-record input or absent source identity instead of making unstable IDs', () => {
    expect(() => normalizeRecord(null, options)).toThrow(TypeError);
    expect(() => normalizeRecord([], options)).toThrow(TypeError);
    expect(() => normalizeRecord(record(), { ...options, lineNumber: 0 })).toThrow(TypeError);
  });
});

describe('character mentions are not speaker labels', () => {
  const characters = [
    { id: 'mine', aliases: ['Mine', '미네', 'Yoshitaka Mine'] },
    { id: 'date', aliases: ['Date', '다테', 'Makoto Date'] },
    { id: 'akiyama', aliases: ['Akiyama', '아키야마'] },
    { id: 'nishiki', aliases: ['Nishiki', '니시키'] },
  ];

  it('avoids ordinary English mine/date and embedded Latin-word false positives', () => {
    expect(
      findCharacterMentions(['That is mine. Choose a date.', 'SuperAkiyamaMode'], characters),
    ).toEqual([]);
    expect(findCharacterMentions(['Yoshitaka Mine met Makoto Date.'], characters)).toEqual([
      { id: 'mine', aliases: ['Yoshitaka Mine'] },
      { id: 'date', aliases: ['Makoto Date'] },
    ]);
  });

  it('keeps all configured relationships, Korean particles, and non-Kiryu exchanges', () => {
    const source = { ...record(), ko_text: '다테에게 아키야마와 니시키가 보낸 편지를 전해 줘.' };
    const result = normalizeRecord(source, { ...options, characters });
    expect(result.mentionedCharacters.map((character) => character.id)).toEqual([
      'date',
      'akiyama',
      'nishiki',
    ]);
    expect(result.review.speaker).toBeNull();
    expect(result.review.recipient).toBeNull();
    expect(result.korean.raw).toBe(source.ko_text);
  });
});
