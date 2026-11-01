/** 系统开启「减少动态效果」时，交互应瞬时完成，而不是播放过渡。 */
export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
