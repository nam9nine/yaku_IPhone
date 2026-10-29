import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SpeechRecognitionController,
  supportsSpeechRecognition,
  type SpeechRecognitionEngine,
  type SpeechRecognitionFailure,
  type SpeechRecognitionState,
  type SpeechResultEvent,
  type SpeechTranscript,
} from './recognition';

class FakeRecognition implements SpeechRecognitionEngine {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = true;
  interimResults = false;
  onstart: SpeechRecognitionEngine['onstart'] = null;
  onresult: SpeechRecognitionEngine['onresult'] = null;
  onerror: SpeechRecognitionEngine['onerror'] = null;
  onend: SpeechRecognitionEngine['onend'] = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
}
function event(parts: [string, boolean][], resultIndex = 0): SpeechResultEvent {
  return {
    resultIndex,
    results: parts.map(([transcript, isFinal]) => ({ 0: { transcript }, length: 1, isFinal })),
  };
}
function setup() {
  const states: SpeechRecognitionState[] = [];
  const transcripts: SpeechTranscript[] = [];
  const errors: SpeechRecognitionFailure[] = [];
  const controller = new SpeechRecognitionController({
    recognitionConstructor: FakeRecognition,
    onState: (state) => states.push(state),
    onTranscript: (transcript) => transcripts.push(transcript),
    onError: (error) => errors.push(error),
  });
  const engine = () => FakeRecognition.instances.at(-1)!;
  return { controller, states, transcripts, errors, engine };
}
afterEach(() => {
  vi.unstubAllGlobals();
  FakeRecognition.instances = [];
});

describe('브라우저 음성 인식 수명', () => {
  it('지원 확인은 마이크를 열지 않고 표준·webkit 이름을 모두 인식한다', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    expect(supportsSpeechRecognition()).toBe(false);
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    expect(supportsSpeechRecognition()).toBe(true);
    expect(FakeRecognition.instances).toHaveLength(0);
    const fallback = new SpeechRecognitionController({
      onState: vi.fn(),
      onTranscript: vi.fn(),
      onError: vi.fn(),
    });
    expect(fallback.supported).toBe(true);
    fallback.start();
    expect(FakeRecognition.instances).toHaveLength(1);
    fallback.dispose();
    const standard = vi.fn(function () {
      return new FakeRecognition();
    });
    vi.stubGlobal('SpeechRecognition', standard);
    const preferred = new SpeechRecognitionController({
      onState: vi.fn(),
      onTranscript: vi.fn(),
      onError: vi.fn(),
    });
    preferred.start();
    expect(standard).toHaveBeenCalledOnce();
    preferred.dispose();
  });

  it('미지원 브라우저에서는 명시적 start에만 입력 대안을 안내한다', () => {
    const onError = vi.fn();
    const controller = new SpeechRecognitionController({
      recognitionConstructor: null,
      onError,
      onState: vi.fn(),
      onTranscript: vi.fn(),
    });
    expect(controller.supported).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    expect(controller.start()).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'unsupported' }));
  });

  it('start를 동기 호출하고 native 시작 전에는 듣는 중이라고 표시하지 않는다', () => {
    const { controller, engine, states } = setup();
    expect(controller.start()).toBe(true);
    expect(engine().start).toHaveBeenCalledOnce();
    expect(engine()).toMatchObject({ lang: 'ko-KR', continuous: false, interimResults: true });
    expect(states).toEqual(['starting']);
    expect(controller.start()).toBe(false);
    engine().onstart?.();
    expect(states).toEqual(['starting', 'listening']);
  });

  it('중간 결과를 갱신하고 동일한 최종 결과가 반복돼도 문장을 중복하지 않는다', () => {
    const { controller, engine, transcripts } = setup();
    controller.start();
    engine().onresult?.(event([['형님', false]]));
    engine().onresult?.(event([['형님 안녕하세요', true]]));
    engine().onresult?.(event([['형님 안녕하세요', true]]));
    engine().onresult?.(
      event(
        [
          ['형님 안녕하세요', true],
          ['저는 지금', false],
        ],
        1,
      ),
    );
    engine().onresult?.(
      event(
        [
          ['형님 안녕하세요', true],
          ['저는 지금 갑니다', true],
        ],
        1,
      ),
    );
    expect(transcripts.map((entry) => entry.text)).toEqual([
      '',
      '형님',
      '형님 안녕하세요',
      '형님 안녕하세요 저는 지금',
      '형님 안녕하세요 저는 지금 갑니다',
    ]);
    expect(transcripts.at(-1)).toEqual({
      text: '형님 안녕하세요 저는 지금 갑니다',
      finalText: '형님 안녕하세요 저는 지금 갑니다',
      interimText: '',
    });
  });

  it('사라진 중간 후보를 제거하고 확정 결과를 중간 결과로 되돌리지 않는다', () => {
    const { controller, engine, transcripts } = setup();
    controller.start();
    engine().onresult?.(
      event([
        ['형님', true],
        ['잘못 들은 말', false],
      ]),
    );
    engine().onresult?.(event([['형님', true]], 1));
    engine().onresult?.(event([['다른 말', false]]));
    expect(transcripts.at(-1)).toEqual({ text: '형님', finalText: '형님', interimText: '' });
  });

  it('stop 뒤 마지막 final을 받고 end에서 종료하며 반복 stop은 한 번만 전달한다', () => {
    const { controller, engine, states, transcripts } = setup();
    controller.start();
    engine().onstart?.();
    engine().onresult?.(event([['지금', false]]));
    controller.stop();
    controller.stop();
    expect(engine().stop).toHaveBeenCalledOnce();
    expect(engine().abort).not.toHaveBeenCalled();
    expect(states.at(-1)).toBe('stopping');
    engine().onresult?.(event([['지금 가겠습니다', true]]));
    engine().onend?.();
    expect(transcripts.at(-1)?.text).toBe('지금 가겠습니다');
    expect(states).toEqual(['starting', 'listening', 'stopping', 'idle']);
  });

  it('stop 안에서 final과 end가 동기로 발생해도 idle을 다시 stopping으로 덮지 않는다', () => {
    const { controller, engine, states, transcripts } = setup();
    controller.start();
    const current = engine();
    current.stop.mockImplementation(() => {
      current.onresult?.(event([['알겠습니다', true]]));
      current.onend?.();
    });
    controller.stop();
    expect(states.at(-1)).toBe('idle');
    expect(transcripts.at(-1)?.finalText).toBe('알겠습니다');
    expect(current.abort).not.toHaveBeenCalled();
  });

  it('권한 대기 중 stop 뒤 늦게 도착한 onstart가 stopping 상태를 되돌리지 않는다', () => {
    const { controller, engine, states } = setup();
    controller.start();
    controller.stop();
    engine().onstart?.();
    expect(states).toEqual(['starting', 'stopping']);
    engine().onend?.();
    expect(states.at(-1)).toBe('idle');
  });

  it('오류가 끝낸 세션의 idle 콜백에서 dispose해도 이후 오류 콜백을 호출하지 않는다', () => {
    const onError = vi.fn();
    const controller = new SpeechRecognitionController({
      recognitionConstructor: FakeRecognition,
      onState: (state) => {
        if (state === 'idle') controller.dispose();
      },
      onTranscript: vi.fn(),
      onError,
    });
    controller.start();
    FakeRecognition.instances.at(-1)!.onerror?.({ error: 'network' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('취소한 인식기의 늦은 start/result/error/end가 새 인식에 끼어들지 않는다', () => {
    const { controller, engine, states, transcripts, errors } = setup();
    controller.start();
    const old = engine();
    const late = {
      start: old.onstart!,
      result: old.onresult!,
      error: old.onerror!,
      end: old.onend!,
    };
    controller.cancel();
    expect(old.abort).toHaveBeenCalledOnce();
    controller.start();
    engine().onstart?.();
    late.start();
    late.result(event([['취소된 말', true]]));
    late.error({ error: 'network' });
    late.end();
    expect(states.at(-1)).toBe('listening');
    expect(transcripts.at(-1)?.text).toBe('');
    expect(errors).toEqual([]);
    expect(engine().abort).not.toHaveBeenCalled();
  });

  it('dispose는 abort하고 콜백과 재시작을 모두 차단한다', () => {
    const { controller, engine, states, transcripts, errors } = setup();
    controller.start();
    const current = engine();
    const lateResult = current.onresult!;
    const before = [states.length, transcripts.length, errors.length];
    controller.dispose();
    controller.dispose();
    lateResult(event([['뒤늦은 문장', true]]));
    expect(current.abort).toHaveBeenCalledOnce();
    expect([states.length, transcripts.length, errors.length]).toEqual(before);
    expect(controller.start()).toBe(false);
  });

  it.each([
    ['not-allowed', 'permission-denied'],
    ['service-not-allowed', 'permission-denied'],
    ['network', 'network'],
    ['no-speech', 'no-speech'],
    ['audio-capture', 'microphone'],
    ['language-not-supported', 'unsupported'],
  ])('브라우저 오류 %s를 %s로 안내하고 후속 end를 중복 처리하지 않는다', (native, code) => {
    const { controller, engine, errors, states } = setup();
    controller.start();
    const lateEnd = engine().onend!;
    engine().onerror?.({ error: native });
    lateEnd();
    expect(errors).toEqual([expect.objectContaining({ code })]);
    expect(states).toEqual(['starting', 'idle']);
    expect(controller.start()).toBe(true);
  });

  it('권한 요청 자체가 동기 예외를 던져도 다시 시도할 수 있다', () => {
    const onError = vi.fn();
    class DeniedRecognition extends FakeRecognition {
      start = vi.fn(() => {
        throw new DOMException('denied', 'NotAllowedError');
      });
    }
    const states: SpeechRecognitionState[] = [];
    const controller = new SpeechRecognitionController({
      recognitionConstructor: DeniedRecognition,
      onState: (state) => states.push(state),
      onTranscript: vi.fn(),
      onError,
    });
    expect(controller.start()).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'permission-denied' }));
    expect(states).toEqual(['starting', 'idle']);
    expect(FakeRecognition.instances[0].abort).toHaveBeenCalledOnce();
    expect(controller.start()).toBe(false);
    expect(FakeRecognition.instances).toHaveLength(2);
  });

  it('최종·중간 문장을 합친 길이를 1000자 이내로 제한하고 서로게이트를 자르지 않는다', () => {
    const { controller, engine, transcripts } = setup();
    controller.start();
    engine().onresult?.(
      event([
        ['가'.repeat(995), true],
        ['나'.repeat(30), false],
      ]),
    );
    expect(transcripts.at(-1)?.text).toHaveLength(1000);
    expect(transcripts.at(-1)?.interimText).toHaveLength(4);
    engine().onresult?.(event([['가'.repeat(999) + '😀', true]]));
    expect(transcripts.at(-1)?.text).toHaveLength(999);
  });
});
