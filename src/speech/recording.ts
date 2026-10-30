import type { AiConnection } from '../ai/connection';
import type { AiCharacter } from '../ai/client';

/** One explicit microphone session, never the remote participant or ambient background. */
export class CallRecording {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private cancelled = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  async start(connection: AiConnection, character: AiCharacter) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (this.cancelled) {
      stream.getTracks().forEach((track) => track.stop());
      return false;
    }
    this.stream = stream;
    try {
      const mimeType = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      if (!mimeType) throw new Error('녹음 미지원');
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 });
      this.recorder = recorder;
      const chunks: Blob[] = [];
      const id = crypto.randomUUID();
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      this.saved = new Promise<void>((resolve, reject) => {
        recorder.onerror = () => {
          this.stop();
          reject(new Error('녹음 실패'));
        };
        recorder.onstop = () => {
          this.stopTracks();
          const blob = new Blob(chunks, { type: mimeType });
          if (!blob.size) {
            resolve();
            return;
          }
          if (blob.size > 2 * 1024 * 1024) {
            reject(new Error('녹음 용량 초과'));
            return;
          }
          void fetch(`${connection.endpoint}/v1/recordings/${character}/${id}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': mimeType },
            body: blob,
            signal: AbortSignal.timeout(30_000),
          })
            .then((response) => {
              if (!response.ok) throw new Error('녹음 저장 실패');
              resolve();
            })
            .catch(reject);
        };
      });
      // Attach rejection handler immediately; the caller observes the same promise.
      void this.saved.catch(() => {});
      recorder.start();
      this.timer = setTimeout(() => this.stop(), 30_000);
      return true;
    } catch (error) {
      this.stopTracks();
      throw error;
    }
  }
  saved: Promise<void> = Promise.resolve();
  private stopTracks() {
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
  stop() {
    this.cancelled = true;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.stopTracks();
  }
}
