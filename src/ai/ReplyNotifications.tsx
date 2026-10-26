import { useEffect, useRef } from 'react';
import { AppIcon } from '../home/AppIcon';
import { contacts } from '../story/data';
import type { AiReplyNotification } from './messenger';
import './reply-notifications.css';

function ReplyCard({
  reply,
  onOpen,
}: {
  reply: AiReplyNotification;
  onOpen: (id: string) => void;
}) {
  const person = contacts.find((contact) => contact.id === reply.character)!;
  return (
    <button
      className="day-notification"
      onClick={() => onOpen(reply.character)}
      aria-label={`${person.shortName}의 새 메시지 알림 열기`}
    >
      <span className="notification-symbol">
        <AppIcon id="messages" day="24" weekday="토" />
      </span>
      <span className="notification-copy">
        <span className="notification-heading">
          <strong>{person.shortName}</strong>
          <small>지금</small>
        </span>
        <span className="ai-notification-preview">{reply.text}</span>
      </span>
    </button>
  );
}

export function AiReplyNotifications({
  replies,
  onOpen,
}: {
  replies: AiReplyNotification[];
  onOpen: (id: string) => void;
}) {
  if (!replies.length) return null;
  return (
    <div className="day-notifications" aria-label="새 메시지 알림">
      {replies
        .slice(-5)
        .reverse()
        .map((reply) => (
          <ReplyCard key={reply.id} reply={reply} onOpen={onOpen} />
        ))}
    </div>
  );
}

/** User gesture unlock only. No OS permission prompt or queued sound on return. */
function useReplySound(id: string | undefined, silent: boolean, volume: number) {
  const audio = useRef<AudioContext | null>(null);
  const played = useRef<string | undefined>(undefined);
  useEffect(() => {
    const unlock = () => {
      if (!window.AudioContext) return;
      try {
        audio.current ??= new AudioContext();
        if (audio.current.state === 'suspended') void audio.current.resume().catch(() => {});
      } catch {
        /* Muted/unsupported browser still receives the visual notification. */
      }
    };
    document.addEventListener('pointerup', unlock, true);
    document.addEventListener('keydown', unlock, true);
    return () => {
      document.removeEventListener('pointerup', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      void audio.current?.close().catch(() => {});
      audio.current = null;
    };
  }, []);
  useEffect(() => {
    if (!id || played.current === id) return;
    played.current = id;
    const context = audio.current;
    if (silent || volume <= 0 || document.hidden || !context || context.state !== 'running') return;
    for (const [offset, frequency] of [
      [0, 880],
      [0.12, 1174],
    ] as const) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + offset;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(Math.min(1, volume / 100) * 0.12, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.27);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    }
  }, [id, silent, volume]);
}

export function AiReplyBanner({
  notification,
  onOpen,
  onDismiss,
  silent,
  volume,
  obscured,
}: {
  notification: AiReplyNotification | null;
  onOpen: (id: string) => void;
  onDismiss: () => void;
  silent: boolean;
  volume: number;
  obscured: boolean;
}) {
  useReplySound(notification?.id, silent, volume);
  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [notification, onDismiss]);
  if (!notification || obscured) return null;
  return (
    <aside className="ai-reply-banner" aria-label="새 메시지 도착" role="status">
      <ReplyCard
        reply={notification}
        onOpen={(id) => {
          onDismiss();
          onOpen(id);
        }}
      />
      <button className="ai-notification-dismiss" aria-label="메시지 알림 닫기" onClick={onDismiss}>
        ×
      </button>
    </aside>
  );
}
