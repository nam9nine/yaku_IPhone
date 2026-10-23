import { edgeDirection } from './horizontalGesture';
import { useHorizontalGesture } from './useHorizontalGesture';

export function useEdgeNavigation({
  active,
  onBack,
  onForward,
}: {
  active: boolean;
  onBack?: () => void;
  onForward?: () => void;
}) {
  return useHorizontalGesture({
    active,
    start(event) {
      const rect = event.currentTarget.getBoundingClientRect();
      // Reserve both inset edges even at the start/end of a history. They must not
      // fall through to content pagination or manufacture a home transition.
      return edgeDirection(
        event.clientX - rect.left,
        event.clientY - rect.top,
        rect.width,
        rect.height,
        true,
        true,
      );
    },
    commit(direction) {
      if (direction === 'previous') onBack?.();
      else onForward?.();
    },
  });
}
