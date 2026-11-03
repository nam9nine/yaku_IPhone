type SessionNavigator = Navigator & { audioSession?: { type: string } };

/**
 * WebKit grants the microphone only in an `auto` or `play-and-record` audio
 * session, and reply tones switch `auto` to `transient` on every tap. Hold
 * `play-and-record` while one microphone user is live; the release restores
 * the previous type unless something else changed it meanwhile.
 */
export function holdCaptureSession(): () => void {
  let session: { type: string } | undefined;
  let previous: string;
  try {
    session = (navigator as SessionNavigator).audioSession;
    if (!session || session.type === 'play-and-record') return () => {};
    previous = session.type;
    session.type = 'play-and-record';
  } catch {
    /* Optional API: capture still starts where audio sessions are unsupported. */
    return () => {};
  }
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    try {
      if (session.type === 'play-and-record') session.type = previous;
    } catch {
      /* The next reply tone unlock sets its own session type. */
    }
  };
}
