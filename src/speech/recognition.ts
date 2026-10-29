export type SpeechRecognitionState = 'idle' | 'starting' | 'listening' | 'stopping';
export interface SpeechTranscript {
  text: string;
  finalText: string;
  interimText: string;
}
export interface SpeechRecognitionFailure {
  code:
    | 'permission-denied'
    | 'network'
    | 'no-speech'
    | 'unsupported'
    | 'microphone'
    | 'aborted'
    | 'unknown';
  message: string;
}
export interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { readonly transcript: string };
}
export interface SpeechResultEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechResult>;
}
/** Minimal Web Speech contract, also used by the injected test engine. */
export interface SpeechRecognitionEngine {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type SpeechRecognitionConstructor = new () => SpeechRecognitionEngine;
export interface SpeechRecognitionOptions {
  onState: (state: SpeechRecognitionState) => void;
  onTranscript: (transcript: SpeechTranscript) => void;
  onError: (failure: SpeechRecognitionFailure) => void;
  /** Undefined detects the browser; null deliberately represents no support. */
  recognitionConstructor?: SpeechRecognitionConstructor | null;
}

function browserConstructor(): SpeechRecognitionConstructor | null {
  const browser = globalThis as typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  if (typeof browser.SpeechRecognition === 'function') return browser.SpeechRecognition;
  if (typeof browser.webkitSpeechRecognition === 'function') return browser.webkitSpeechRecognition;
  return null;
}
/** Detection only: does not construct an engine or ask for microphone permission. */
export function supportsSpeechRecognition(): boolean {
  return browserConstructor() !== null;
}

function failure(code: string): SpeechRecognitionFailure {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        code: 'permission-denied',
        message: '마이크 사용이 허용되지 않았어요. 직접 입력할 수 있어요.',
      };
    case 'network':
      return {
        code: 'network',
        message: '음성 인식 연결이 끊겼어요. 다시 시도하거나 직접 입력해 주세요.',
      };
    case 'no-speech':
      return {
        code: 'no-speech',
        message: '말소리를 듣지 못했어요. 다시 시도하거나 직접 입력해 주세요.',
      };
    case 'unsupported':
    case 'language-not-supported':
      return {
        code: 'unsupported',
        message: '이 브라우저에서는 음성 인식을 사용할 수 없어요. 직접 입력해 주세요.',
      };
    case 'audio-capture':
    case 'NotFoundError':
    case 'NotReadableError':
      return {
        code: 'microphone',
        message: '마이크를 사용할 수 없어요. 마이크를 확인하거나 직접 입력해 주세요.',
      };
    case 'aborted':
    case 'AbortError':
      return {
        code: 'aborted',
        message: '음성 인식이 중단됐어요. 다시 시도하거나 직접 입력해 주세요.',
      };
    default:
      return {
        code: 'unknown',
        message: '음성을 인식하지 못했어요. 다시 시도하거나 직접 입력해 주세요.',
      };
  }
}
function exceptionName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
function capped(text: string, limit = 1000): string {
  // Do not leave a half surrogate at the character limit.
  return text
    .slice(0, Math.max(0, limit))
    .replace(/[\uD800-\uDBFF]$/, '')
    .trim();
}

interface RecognitionRun {
  engine: SpeechRecognitionEngine;
  fragments: Map<number, { text: string; final: boolean }>;
  last: SpeechTranscript;
}

/**
 * A user-initiated recognition session. Browser recognition can use a remote
 * service; this wrapper makes no claim that audio stays on the device.
 * stop() keeps final results until end. cancel()/dispose() discard late events.
 */
export class SpeechRecognitionController {
  readonly supported: boolean;
  private readonly Constructor: SpeechRecognitionConstructor | null;
  private run: RecognitionRun | null = null;
  private disposed = false;
  private state: SpeechRecognitionState = 'idle';

  constructor(private readonly options: SpeechRecognitionOptions) {
    this.Constructor =
      options.recognitionConstructor === undefined
        ? browserConstructor()
        : options.recognitionConstructor;
    this.supported = this.Constructor !== null;
  }

  start(): boolean {
    if (this.disposed || this.run) return false;
    if (!this.Constructor) {
      this.options.onError(failure('unsupported'));
      return false;
    }
    let engine: SpeechRecognitionEngine;
    try {
      engine = new this.Constructor();
    } catch (error) {
      this.options.onError(failure(exceptionName(error)));
      return false;
    }
    const run: RecognitionRun = {
      engine,
      fragments: new Map(),
      last: { text: '', finalText: '', interimText: '' },
    };
    this.run = run;
    engine.lang = 'ko-KR';
    engine.continuous = false;
    engine.interimResults = true;
    engine.onstart = () => {
      if (this.run === run && this.state === 'starting') this.setState('listening');
    };
    engine.onresult = (event) => {
      if (this.run !== run || this.disposed) return;
      for (const [index, fragment] of run.fragments)
        if (index >= event.results.length && !fragment.final) run.fragments.delete(index);
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (!result || !result.length || (run.fragments.get(index)?.final && !result.isFinal))
          continue;
        run.fragments.set(index, {
          text: result[0].transcript.replace(/\s+/g, ' ').trim(),
          final: result.isFinal,
        });
      }
      const ordered = [...run.fragments.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, value]) => value);
      const finalText = capped(
        ordered
          .filter((part) => part.final)
          .map((part) => part.text)
          .join(' '),
      );
      const interimText = capped(
        ordered
          .filter((part) => !part.final)
          .map((part) => part.text)
          .join(' '),
        1000 - finalText.length - Number(!!finalText),
      );
      const transcript = {
        text: [finalText, interimText].filter(Boolean).join(' '),
        finalText,
        interimText,
      };
      if (
        transcript.text === run.last.text &&
        transcript.finalText === run.last.finalText &&
        transcript.interimText === run.last.interimText
      )
        return;
      run.last = transcript;
      this.options.onTranscript(transcript);
    };
    engine.onerror = ({ error }) => {
      if (this.run !== run || this.disposed) return;
      this.finish(run, true);
      if (!this.disposed) this.options.onError(failure(error));
    };
    engine.onend = () => {
      if (this.run === run && !this.disposed) this.finish(run, false);
    };
    this.setState('starting');
    if (this.run !== run || this.disposed) return false;
    this.options.onTranscript(run.last);
    if (this.run !== run || this.disposed) return false;
    try {
      // Deliberately synchronous: keep the browser's user-activation context.
      engine.start();
      return true;
    } catch (error) {
      if (this.run === run) {
        this.finish(run, true);
        if (!this.disposed) this.options.onError(failure(exceptionName(error)));
      }
      return false;
    }
  }

  stop(): void {
    const run = this.run;
    if (!run || this.state === 'stopping' || this.disposed) return;
    this.setState('stopping');
    if (this.run !== run || this.disposed) return;
    try {
      run.engine.stop();
    } catch (error) {
      if (this.run === run) {
        this.finish(run, true);
        if (!this.disposed) this.options.onError(failure(exceptionName(error)));
      }
    }
  }

  cancel(): void {
    if (this.run) this.finish(this.run, true);
  }

  dispose(): void {
    this.disposed = true;
    if (this.run) this.finish(this.run, true);
  }

  private setState(state: SpeechRecognitionState): void {
    if (state === this.state) return;
    this.state = state;
    if (!this.disposed) this.options.onState(state);
  }

  private finish(run: RecognitionRun, abort: boolean): void {
    if (this.run !== run) return;
    this.run = null;
    run.engine.onstart = run.engine.onresult = run.engine.onerror = run.engine.onend = null;
    if (abort) {
      try {
        run.engine.abort();
      } catch {
        /* The browser may already have ended. */
      }
    }
    this.setState('idle');
  }
}
