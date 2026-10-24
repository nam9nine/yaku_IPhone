import type { LaunchRect } from './session';

export const motion = { settle: 420, home: 360, cancel: 280 };
export const dragMotion = { stage: 64, previewStart: 12, previewDistance: 60 };

export function draggedRect(base: LaunchRect, distance: number): LaunchRect {
  // Reveal the card edges during a short lift, then smoothly rejoin the long
  // upward motion. The lead fades without a threshold jump or a larger rebound.
  const lead = 0.16 * (1 - Math.exp(-distance / 32)) * Math.exp(-distance / (base.height * 0.25));
  const scale = Math.max(0.12, 1 - (distance / base.height) * 1.25 - lead);
  return {
    x: base.x + (base.width * (1 - scale)) / 2,
    y: base.y + base.height * (1 - scale) - distance,
    width: base.width * scale,
    height: base.height * scale,
  };
}

export function reducedMotion(node: HTMLElement) {
  return (
    parseFloat(getComputedStyle(node).getPropertyValue('--motion-settle')) === 0 ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function rectOf(node: Element): LaunchRect {
  const { x, y, width, height } = node.getBoundingClientRect();
  return { x, y, width, height };
}

/** A critically damped spring, sampled once rather than running a JS frame loop. */
export function rectFrames(
  from: LaunchRect,
  to: LaunchRect,
  base: LaunchRect,
  radius: [number, number],
  fade = false,
): Keyframe[] {
  return Array.from({ length: 31 }, (_, index) => {
    const time = index / 30;
    const progress = index === 30 ? 1 : 1 - (1 + time * 9) * Math.exp(-time * 9);
    const mix = (a: number, b: number) => a + (b - a) * progress;
    return {
      offset: time,
      transform: `translate(${mix(from.x, to.x) - base.x}px, ${mix(from.y, to.y) - base.y}px) scale(${mix(from.width, to.width) / base.width}, ${mix(from.height, to.height) / base.height})`,
      borderRadius: `${mix(radius[0], radius[1])}px`,
      ...(fade ? { opacity: 1 - progress ** 4 } : {}),
    };
  });
}
