/**
 * Shared visual tokens for the dark frosted "chip" chrome used across the
 * analysis screen. Single source of truth for the surface recipe so every
 * floating chip (TopBar, BottomBar tray, LayerControlCluster, rail, pane,
 * CoordsBadge, ScaleBar, CloudHiddenToast, FieldSwitcherChip,
 * GetOverviewButton) stays in lockstep.
 *
 * See `docs/ui-ux-redesign.md` § 13 (Appendix — Design tokens).
 */

export const CHIP_BASE =
  'rounded-lg border border-white/10 bg-black/70 text-white shadow-lg backdrop-blur-md saturate-150';

export const CHIP_FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/70';
