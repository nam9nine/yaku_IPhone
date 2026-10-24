import { useEffect, useRef, useState } from 'react';
import { AiRequestError, createSession, getHealth } from './client';
import { normalizeEndpoint, type AiConnection, type AiInvite } from './connection';

export function AiConnectionDialog({
  connection,
  invite,
  active,
  online,
  onConnect,
  onDisconnect,
  onClose,
}: {
  connection: AiConnection | null;
  invite: AiInvite | null;
  active: boolean;
  online: boolean;
  onConnect: (connection: AiConnection) => void;
  onDisconnect: () => void;
  onClose: () => void;
}) {
  const [endpoint, setEndpoint] = useState(invite?.endpoint ?? connection?.endpoint ?? '');
  const [inviteKey, setInviteKey] = useState(invite?.inviteKey ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  let host = '';
  try {
    host = new URL(endpoint).host;
  } catch {
    // The field itself reports invalid addresses on submit.
  }
  useEffect(() => {
    if (!active) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => {
      request.current?.abort();
      previousFocus.current?.focus({ preventScroll: true });
    };
  }, [active]);

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    if (!active || !online || request.current || !inviteKey.trim()) return;
    let normalized: string;
    try {
      normalized = normalizeEndpoint(endpoint);
    } catch (error) {
      setError((error as Error).message);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const status = await getHealth(normalized, controller.signal);
      if (controller.signal.aborted) return;
      if (status !== 'ready') {
        setError(
          status === 'loading'
            ? 'Mac에서 모델을 불러오는 중입니다. 준비된 후 다시 연결해 주세요.'
            : 'Mac의 모델을 사용할 수 없습니다. 서버 상태를 확인해 주세요.',
        );
        return;
      }
      const next = await createSession(normalized, inviteKey.trim(), controller.signal);
      if (controller.signal.aborted) return;
      setInviteKey('');
      onConnect(next);
      onClose();
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof AiRequestError ? error.message : 'Mac에 연결할 수 없습니다.');
    } finally {
      request.current = null;
      setBusy(false);
    }
  }

  return (
    <div className="message-connection-backdrop">
      <div
        ref={dialog}
        className="message-connection-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="message-connection-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            event.preventDefault();
            onClose();
          }
          if (event.key !== 'Tab') return;
          const controls = dialog.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled)',
          );
          if (!controls?.length) return;
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <h2 id="message-connection-title">Mac 연결</h2>
        <p>하루카와 마지마의 답장을 이 Mac에서 만듭니다.</p>
        <form onSubmit={(event) => void connect(event)}>
          <label>
            <span>Mac 서버 주소</span>
            <input
              type="url"
              inputMode="url"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="https://"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              disabled={busy}
            />
          </label>
          {host && <p className="message-connection-host">연결할 서버: {host}</p>}
          <label>
            <span>접속 키</span>
            <input
              type="password"
              value={inviteKey}
              onChange={(event) => setInviteKey(event.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              disabled={busy}
            />
          </label>
          <p className="message-connection-help">
            연결하면 입력한 메시지가 위 서버로 전송됩니다. 접속 정보는 이 브라우저에 저장됩니다.
          </p>
          {error && <p role="alert">{error}</p>}
          {!online && <p role="status">연결 끊김 · 연결을 켠 후 다시 시도해 주세요.</p>}
          <button type="submit" disabled={busy || !online || !active || !inviteKey.trim()}>
            {busy ? '연결 중…' : '연결'}
          </button>
        </form>
        {connection && (
          <button
            type="button"
            className="message-connection-disconnect"
            onClick={() => {
              onDisconnect();
              onClose();
            }}
          >
            연결 해제
          </button>
        )}
        <button type="button" onClick={onClose}>
          취소
        </button>
      </div>
    </div>
  );
}
