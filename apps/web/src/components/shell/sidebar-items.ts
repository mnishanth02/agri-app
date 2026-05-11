/**
 * Module 5.3 — `RightSidebar` items config.
 *
 * Single source of truth for the icon-rail items rendered by
 * `<RightSidebar />`. Order, labels, and icons map 1:1 to the bullet list
 * in `docs/plan.md` § 2 → "Right sidebar"; ids are the `SidebarItem`
 * union members declared in `useUiStore.ts` (camelCased internal keys,
 * not URL slugs).
 *
 * Items are split into two visual groups:
 *
 * - **`primary`** — analysis tools that act on the currently-loaded field
 *   (Sample, Monitoring, Weather, Field activity, VRA maps, Scout tasks,
 *   Data manager, Field manager).
 * - **`secondary`** — cross-cutting workspace utilities (AI assistant,
 *   Notifications, Help Center, Marketplace).
 *
 * `RightSidebar` renders a faint hairline between the two groups so the
 * rail reads as two clusters rather than one long column. The grouping
 * is purely visual — every id behaves identically.
 *
 * Only `sample` renders a real pane in v2 (Phase 7 fills it with NDVI
 * stats); the rest render a "Coming soon" placeholder. See the JSDoc on
 * `SidebarItem` in `useUiStore.ts` for the rationale.
 */

import {
  Activity,
  Bell,
  ClipboardCheck,
  Cloud,
  Database,
  HelpCircle,
  Layers,
  ListTodo,
  type LucideIcon,
  Map as MapIcon,
  Microscope,
  Sparkles,
  Store,
} from 'lucide-react';
import type { SidebarItem } from '@/stores/useUiStore';

export type SidebarItemGroup = 'primary' | 'secondary';

export type SidebarItemConfig = {
  id: SidebarItem;
  label: string;
  icon: LucideIcon;
  group: SidebarItemGroup;
  /** One-line teaser shown in the "Coming soon" pane to differentiate items. */
  description: string;
};

export const SIDEBAR_ITEMS: ReadonlyArray<SidebarItemConfig> = [
  {
    id: 'sample',
    label: 'Sample',
    icon: Microscope,
    group: 'primary',
    description: 'NDVI sample stats for the selected scene.',
  },
  {
    id: 'monitoring',
    label: 'Monitoring',
    icon: Activity,
    group: 'primary',
    description: 'Track field health trends over time.',
  },
  {
    id: 'weather',
    label: 'Weather',
    icon: Cloud,
    group: 'primary',
    description: 'Local forecast and historic conditions for this field.',
  },
  {
    id: 'fieldActivity',
    label: 'Field activity log',
    icon: ListTodo,
    group: 'primary',
    description: 'Record sowing, irrigation, and treatment events.',
  },
  {
    id: 'vraMaps',
    label: 'VRA maps',
    icon: MapIcon,
    group: 'primary',
    description: 'Variable-rate application maps for inputs.',
  },
  {
    id: 'scoutTasks',
    label: 'Scout tasks',
    icon: ClipboardCheck,
    group: 'primary',
    description: 'Assign and complete in-field inspection tasks.',
  },
  {
    id: 'dataManager',
    label: 'Data manager',
    icon: Database,
    group: 'primary',
    description: 'Import, export, and review field datasets.',
  },
  {
    id: 'fieldManager',
    label: 'Field manager',
    icon: Layers,
    group: 'primary',
    description: 'Edit metadata and manage related layers.',
  },
  {
    id: 'aiAssistant',
    label: 'AI assistant',
    icon: Sparkles,
    group: 'secondary',
    description: 'Ask questions about your field in natural language.',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
    group: 'secondary',
    description: 'Alerts about scenes, weather, and field events.',
  },
  {
    id: 'helpCenter',
    label: 'Help center',
    icon: HelpCircle,
    group: 'secondary',
    description: 'Guides and articles for using the platform.',
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    icon: Store,
    group: 'secondary',
    description: 'Discover services and add-ons from partners.',
  },
] as const;

/**
 * Lookup helper for the active item's config (label + icon). Linear scan
 * is fine — the array has a fixed length of 12.
 */
export function getSidebarItem(id: SidebarItem): SidebarItemConfig {
  const found = SIDEBAR_ITEMS.find((item) => item.id === id);
  if (!found) {
    // Exhaustive — `SidebarItem` and `SIDEBAR_ITEMS` are kept in sync by
    // the type checker (every union member must appear above).
    throw new Error(`Unknown sidebar item id: ${id}`);
  }
  return found;
}
