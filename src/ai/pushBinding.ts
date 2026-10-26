/** Shared IndexedDB generation, not a per-tab flag: stale subscriptions cannot revive after reset. */
export interface PushBinding {
  id: string;
  resetId: string | null;
  scope: string;
}
export interface PushGeneration {
  value: number;
  revokedScopes: string[];
}
const initialGeneration = (): PushGeneration => ({ value: 0, revokedScopes: [] });
function transaction<T>(
  write: boolean,
  operation: (store: IDBObjectStore, result: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('yaku-iphone-push-v1', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('state');
    opening.onerror = () => reject(new Error('알림 설정을 저장할 수 없습니다.'));
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction('state', write ? 'readwrite' : 'readonly');
      let result: T;
      tx.oncomplete = () => {
        resolve(result);
        db.close();
      };
      const failed = () => {
        reject(new Error('알림 설정을 저장할 수 없습니다.'));
        db.close();
      };
      tx.onerror = failed;
      tx.onabort = failed;
      operation(tx.objectStore('state'), (value) => {
        result = value;
      });
    };
  });
}
export function storedPushBinding(): Promise<PushBinding | null> {
  return transaction(false, (store, result) => {
    const request = store.get('binding');
    request.onsuccess = () => result(request.result ?? null);
  });
}
export function pushGeneration(): Promise<PushGeneration> {
  return transaction(false, (store, result) => {
    const request = store.get('generation');
    request.onsuccess = () => result(request.result ?? initialGeneration());
  });
}
export function commitPushBinding(
  expected: number,
  binding: PushBinding,
  previousId?: string,
): Promise<boolean> {
  return transaction(true, (store, result) => {
    const request = store.get('generation');
    request.onsuccess = () => {
      const generation: PushGeneration = request.result ?? initialGeneration();
      if (generation.value !== expected || generation.revokedScopes.includes(binding.scope)) {
        result(false);
        return;
      }
      if (previousId !== undefined) {
        const current = store.get('binding');
        current.onsuccess = () => {
          if (current.result?.id !== previousId || current.result.scope !== binding.scope) {
            result(false);
            return;
          }
          store.put(binding, 'binding');
          result(true);
        };
      } else {
        store.put(binding, 'binding');
        result(true);
      }
    };
  });
}
export function clearPushBinding(expectedId?: string): Promise<boolean> {
  return transaction(true, (store, result) => {
    const request = store.get('binding');
    request.onsuccess = () => {
      if (expectedId !== undefined && request.result?.id !== expectedId) {
        result(false);
        return;
      }
      store.delete('binding');
      result(true);
    };
  });
}
export function invalidatePushBinding(revokedScope?: string): Promise<void> {
  return transaction(true, (store, result) => {
    const request = store.get('generation');
    request.onsuccess = () => {
      const previous: PushGeneration = request.result ?? initialGeneration();
      const scopes = revokedScope
        ? [...new Set([...previous.revokedScopes, revokedScope])]
        : previous.revokedScopes;
      store.put({ value: previous.value + 1, revokedScopes: scopes }, 'generation');
      store.delete('binding');
      result(undefined);
    };
  });
}
