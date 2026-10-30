import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AppIcon } from '../home/AppIcon';
import { ReplySoundPlayer } from '../ai/replySound';
import { contacts } from '../story/data';
import { useDay } from './DayContext';
import { historyOnlyContacts, type ContactId, type DayMessage } from './content';

type Arrival = { character: ContactId; message: DayMessage };
function Card({ arrival, onOpen }: { arrival: Arrival; onOpen: (id: string) => void }) {
  const person = contacts.find((contact) => contact.id === arrival.character)!;
  return (
    <button
      className="day-notification"
      onClick={() => onOpen(person.id)}
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
        <span className="ai-notification-preview">{arrival.message.text}</span>
      </span>
    </button>
  );
}
export function StoryNotificationList({ onOpen }: { onOpen: (id: string) => void }) {
  const { state } = useDay();
  const unread = contacts.flatMap(({ id }) => {
    if ((historyOnlyContacts as readonly string[]).includes(id)) return [];
    const message = state.storyMessages[id].filter((item) => !item.outgoing).at(-1);
    return message && !state.readThreads.includes(id) ? [{ character: id, message }] : [];
  });
  if (!unread.length) return null;
  return (
    <div className="day-notifications" aria-label="새 이야기 메시지 알림">
      {unread.map((arrival) => (
        <Card key={arrival.message.id} arrival={arrival} onOpen={onOpen} />
      ))}
    </div>
  );
}

/** Local story deliveries only. Opening a thread or restoring storage never plays a sound. */
export function StoryReplyNotifications({
  onOpen,
  inConversation,
  activeCharacter,
  obscured,
  silent,
  volume,
}: {
  onOpen: (id: string) => void;
  inConversation: boolean;
  activeCharacter: string | null;
  obscured: boolean;
  silent: boolean;
  volume: number;
}) {
  const { state } = useDay();
  const seen = useRef(state.storySequence);
  const player = useRef<ReplySoundPlayer | null>(null);
  player.current ??= new ReplySoundPlayer();
  const [queue, setQueue] = useState<Arrival[]>([]);
  const aborts = useRef(new Set<AbortController>());
  const settings = useEffectEvent(() => ({ silent, volume, inConversation, activeCharacter }));
  const cancel = useEffectEvent(() => {
    for (const controller of aborts.current) controller.abort();
    aborts.current.clear();
    player.current?.interrupt();
  });
  useEffect(() => {
    const unlock = () => player.current?.unlock();
    const hide = () => {
      if (document.hidden) {
        cancel();
        setQueue([]);
      }
    };
    for (const name of ['pointerup', 'touchend', 'click', 'keydown'])
      document.addEventListener(name, unlock, true);
    document.addEventListener('visibilitychange', hide);
    return () => {
      cancel();
      for (const name of ['pointerup', 'touchend', 'click', 'keydown'])
        document.removeEventListener(name, unlock, true);
      document.removeEventListener('visibilitychange', hide);
      player.current?.dispose();
    };
  }, []);
  useEffect(() => {
    if (silent || volume <= 0) cancel();
  }, [silent, volume]);
  useEffect(() => {
    const previous = seen.current;
    seen.current = state.storySequence;
    if (state.storySequence < previous) {
      cancel();
      setQueue([]);
      return;
    }
    const arrivals = contacts
      .filter(({ id }) => !(historyOnlyContacts as readonly string[]).includes(id))
      .flatMap(({ id }) =>
        state.storyMessages[id]
          .filter((message) => !message.outgoing && (message.sequence ?? 0) > previous)
          .map((message) => ({ character: id, message })),
      )
      .sort((a, b) => (a.message.sequence ?? 0) - (b.message.sequence ?? 0));
    if (!arrivals.length || document.hidden) return;
    if (!settings().inConversation) setQueue((current) => [...current, ...arrivals]);
    arrivals.forEach((arrival, index) => {
      const controller = new AbortController();
      aborts.current.add(controller);
      const kind =
        settings().activeCharacter === arrival.character ? 'conversation' : 'notification';
      const timer = setTimeout(() => {
        void player.current!.ready(controller.signal, kind).then((ready) => {
          const current = settings();
          player.current?.play(
            arrival.message.id,
            current.silent || !ready,
            current.volume,
            !document.hidden && !controller.signal.aborted,
            kind,
          );
          aborts.current.delete(controller);
        });
      }, index * 1000);
      controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    });
  }, [state.storySequence, state.storyMessages]);
  const [wasInConversation, setWasInConversation] = useState(inConversation);
  if (wasInConversation !== inConversation) {
    setWasInConversation(inConversation);
    if (inConversation && queue.length) setQueue([]);
  }
  const first = queue[0];
  useEffect(() => {
    if (!first || obscured) return;
    const timer = setTimeout(() => setQueue((current) => current.slice(1)), 6000);
    return () => clearTimeout(timer);
  }, [first, obscured]);
  if (!first || inConversation || obscured) return null;
  return (
    <aside className="ai-reply-banner" aria-label="새 이야기 메시지 도착" role="status">
      <Card
        arrival={first}
        onOpen={(id) => {
          setQueue((current) => current.slice(1));
          onOpen(id);
        }}
      />
      <button
        className="ai-notification-dismiss"
        aria-label="이야기 메시지 알림 닫기"
        onClick={() => setQueue((current) => current.slice(1))}
      >
        ×
      </button>
    </aside>
  );
}
