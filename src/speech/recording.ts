import type { AiConnection } from '../ai/connection';
import type { AiCharacter } from '../ai/client';

const MAX_BYTES = 2 * 1024 * 1024;

/** One explicit microphone session. Remote audio and background capture are excluded. */
export class CallRecording {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private cancelled = false;
  private started = false;
  private active = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly onActiveChange: (active: boolean) => void;
  saved: Promise<void> = Promise.resolve();

  constructor(onActiveChange: (active: boolean) => void = () => {}) {
    this.onActiveChange = onActiveChange;
  }

  async start(connection: AiConnection, character: AiCharacter) {
    if (this.started || this.cancelled) return false;
    this.started = true;
    let rejectSaved: ((reason: Error) => void) | undefined;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      this.stream = stream;
      const mimeType = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      if (!mimeType) throw new Error('음성 저장 미지원');
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 });
      this.recorder = recorder;
      const chunks: Blob[] = [];
      const id = crypto.randomUUID();
      let bytes = 0;
      let failed = false;
      this.saved = new Promise<void>((resolve, reject) => {
        rejectSaved = reject;
        const fail = (message: string) => {
          failed = true;
          reject(new Error(message));
          this.stop();
        };
        recorder.ondataavailable = (event) => {
          if (failed || !event.data.size) return;
          bytes += event.data.size;
          if (bytes > MAX_BYTES) {
            fail('음성 용량 초과');
            return;
          }
          chunks.push(event.data);
        };
        recorder.onerror = () => fail('음성 수집 실패');
        recorder.onstop = () => {
          this.stopTracks();
          if (failed) return;
          const blob = new Blob(chunks, { type: mimeType });
          if (!blob.size) {
            resolve();
            return;
          }
          void fetch(`${connection.endpoint}/v1/recordings/${character}/${id}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': mimeType },
            body: blob,
            signal: AbortSignal.timeout(30_000),
          })
            .then((response) => {
              if (!response.ok) throw new Error('음성 저장 실패');
              resolve();
            })
            .catch(() => reject(new Error('음성 저장 실패')));
        };
      });
      // Callers can observe saved after start; handle rejection while permission is pending.
      void this.saved.catch(() => {});
      recorder.start(1000);
      this.setActive(true);
      this.timer = setTimeout(() => this.stop(), 30_000);
      return true;
    } catch (error) {
      this.stop();
      const failure = error instanceof Error ? error : new Error('음성 시작 실패');
      rejectSaved?.(failure);
      throw failure;
    }
  }

  private setActive(value: boolean) {
    if (this.active === value) return;
    this.active = value;
    this.onActiveChange(value);
  }

  private stopTracks() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.setActive(false);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  stop() {
    this.cancelled = true;
    // UI and microphone are off immediately; the final onstop/upload may arrive later.
    this.stopTracks();
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
  }
}
