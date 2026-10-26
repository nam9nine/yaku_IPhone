import { aiRequest, isAiCharacter } from './client';
import { waitForPushWorker } from './pushReadiness';
import { readAiResetId, type AiConnection } from './connection';
import {
  storedPushBinding,
  pushGeneration,
  commitPushBinding,
  clearPushBinding,
  invalidatePushBinding,
  type PushBinding,
} from './pushBinding';

export const PUSH_SETTINGS_EVENT = 'yaku-iphone-push-settings';
async function sessionScope(connection: AiConnection): Promise<string> {
  const bytes = new TextEncoder().encode(connection.endpoint + ':' + connection.token);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (value) => value.toString(16).padStart(2, '0')).join('');
}
export async function readPushBinding(
  connection: AiConnection | null,
): Promise<PushBinding | null> {
  if (
    !connection ||
    !('indexedDB' in window) ||
    pushSupport() !== 'supported' ||
    Notification.permission !== 'granted'
  )
    return null;
  const value = await storedPushBinding();
  if (
    value?.resetId !== readAiResetId() ||
    typeof value?.id !== 'string' ||
    value.scope !== (await sessionScope(connection))
  )
    return null;
  const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  if (!(await registration?.pushManager.getSubscription())) {
    if (await clearPushBinding(value.id)) window.dispatchEvent(new Event(PUSH_SETTINGS_EVENT));
    return null;
  }
  return value;
}
export function pushSupport(): 'supported' | 'install' | 'unsupported' {
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone =
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone;
  if (ios && !standalone) return 'install';
  return window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
    ? 'supported'
    : 'unsupported';
}
export function registerPushWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register(`${import.meta.env.BASE_URL}push-sw.js`, {
    scope: import.meta.env.BASE_URL,
  });
}
function applicationKey(encoded: string): Uint8Array<ArrayBuffer> {
  const value = encoded.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(value + '='.repeat((4 - (value.length % 4)) % 4)), (c) =>
    c.charCodeAt(0),
  );
}
export async function enablePush(connection: AiConnection): Promise<void> {
  const resetId = readAiResetId();
  const generationTask = pushGeneration();
  // Must be invoked directly from the user's button; never from an effect.
  const permissionTask = Notification.requestPermission();
  const generation = await generationTask;
  const permission = await permissionTask;
  if (permission !== 'granted')
    throw new Error('알림이 허용되지 않았습니다. 기기 설정에서 알림을 허용할 수 있습니다.');
  const registration = await waitForPushWorker(navigator.serviceWorker, import.meta.env.BASE_URL);
  const key = (await aiRequest(connection.endpoint, '/v1/push/key', {
    token: connection.token,
  })) as { public_key?: unknown };
  if (typeof key.public_key !== 'string') throw new Error('알림 서비스를 준비하지 못했습니다.');
  let subscription = await registration.pushManager.getSubscription();
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationKey(key.public_key),
  });
  try {
    const result = (await aiRequest(connection.endpoint, '/v1/push/subscriptions', {
      token: connection.token,
      body: { subscription: subscription.toJSON(), platform: 'web' },
    })) as { id?: unknown };
    if (typeof result.id !== 'string' || resetId !== readAiResetId())
      throw new Error('대화가 초기화되었습니다. 알림을 다시 켜 주세요.');
    const scope = await sessionScope(connection);
    if (!(await commitPushBinding(generation.value, { id: result.id, resetId, scope })))
      throw new Error('알림 설정이 변경되었습니다. 다시 켜 주세요.');
    if (resetId !== readAiResetId()) {
      await clearPushBinding(result.id);
      throw new Error('대화가 초기화되었습니다. 알림을 다시 켜 주세요.');
    }
    window.dispatchEvent(new Event(PUSH_SETTINGS_EVENT));
  } catch (error) {
    // Do not unsubscribe a newer binding installed by another tab.
    if (!(await storedPushBinding())) void subscription.unsubscribe().catch(() => {});
    throw error;
  }
}

/** Renew only an existing, explicitly enabled binding in this exact visitor scope. */
export async function renewPush(connection: AiConnection): Promise<void> {
  const generation = await pushGeneration();
  const binding = await readPushBinding(connection);
  if (!binding) return;
  const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) {
    await clearPushBinding(binding.id);
    window.dispatchEvent(new Event(PUSH_SETTINGS_EVENT));
    return;
  }
  const result = (await aiRequest(connection.endpoint, '/v1/push/subscriptions', {
    token: connection.token,
    body: { subscription: subscription.toJSON(), platform: 'web' },
  })) as { id?: unknown };
  if (typeof result.id !== 'string') {
    await clearPushBinding(binding.id);
    window.dispatchEvent(new Event(PUSH_SETTINGS_EVENT));
    return;
  }
  if (await commitPushBinding(generation.value, { ...binding, id: result.id }, binding.id))
    window.dispatchEvent(new Event(PUSH_SETTINGS_EVENT));
}

/** Local tombstone is committed before reset; offline old pushes are then discarded by the SW. */
export async function disablePush(
  connection: AiConnection | null,
  reset = false,
): Promise<boolean> {
  if (!('indexedDB' in window)) return true;
  try {
    await invalidatePushBinding(reset && connection ? await sessionScope(connection) : undefined);
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(PUSH_SETTINGS_EVENT));
  if (!('serviceWorker' in navigator)) return true;
  try {
    const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
    const notifications = await registration?.getNotifications();
    notifications?.forEach((notification) => notification.close());
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      if (connection)
        void aiRequest(connection.endpoint, '/v1/push/subscriptions', {
          token: connection.token,
          method: 'DELETE',
          body: { endpoint: subscription.endpoint },
        }).catch(() => {});
      await subscription.unsubscribe();
    }
  } catch {
    /* The committed local tombstone still prevents old pushes while offline. */
  }
  return true;
}

export function consumeNotificationLink(): 'haruka' | 'majima' | null {
  const params = new URLSearchParams(location.search);
  const character = params.get('conversation');
  if (!isAiCharacter(character ?? undefined)) return null;
  params.delete('conversation');
  const rest = params.toString();
  history.replaceState(
    history.state,
    '',
    `${location.pathname}${rest ? '?' + rest : ''}${location.hash}`,
  );
  return character as 'haruka' | 'majima';
}
