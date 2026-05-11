/**
 * Module 5.6 — `TopBar`.
 *
 * Trimmed top-left chip: back arrow · pin · field name · area. The former
 * "Get overview" CTA and "All fields ▾" dropdown migrated to the
 * top-right slot owned by `AnalysisLayout` (`GetOverviewButton`,
 * `FieldSwitcherChip`); see `docs/ui-ux-redesign.md` § D1 + § R.B.4.
 *
 * Wiring lives outside this file — TopBar is purely presentational and
 * receives the resolved `field: FieldDto` from `AnalysisLayout`.
 */

import { Link } from '@tanstack/react-router';
import type { FieldDto } from '@viz-crop/shared';
import { ArrowLeftIcon, MapPinIcon } from 'lucide-react';
import { CHIP_BASE, CHIP_FOCUS } from '@/lib/tokens';
import { cn } from '@/lib/utils';

export type TopBarProps = {
  field: FieldDto;
  /**
   * DOM id applied to the field-name `<h1>`. The parent layout's
   * `<section aria-labelledby={...}>` references it so the analysis
   * region announces the field name.
   */
  titleId: string;
};

const HECTARES_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function TopBar({ field, titleId }: TopBarProps) {
  const hasArea = field.areaHectares !== null;
  const areaLabel = hasArea
    ? `${HECTARES_FORMATTER.format(field.areaHectares as number)}\u00A0ha`
    : '—';

  return (
    <div className={cn(CHIP_BASE, 'flex h-10 w-auto max-w-[280px] items-center gap-2 pr-3 pl-1.5')}>
      <Link
        to="/"
        aria-label="Back to your fields"
        className={cn(
          'inline-flex size-7 items-center justify-center rounded-md text-white/85 transition-colors hover:bg-white/10 hover:text-white',
          CHIP_FOCUS,
        )}
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
      </Link>

      <div className="flex min-w-0 items-center gap-1.5">
        <MapPinIcon aria-hidden="true" className="size-3.5 shrink-0 text-white/60" />
        <h1
          id={titleId}
          className="m-0 min-w-0 max-w-[clamp(6rem,30vw,12rem)] truncate font-semibold text-sm text-white tracking-tight"
          title={field.name}
        >
          {field.name}
        </h1>
        <span aria-hidden="true" className="text-white/30">
          ·
        </span>
        {hasArea ? (
          <span className="whitespace-nowrap text-white/85 text-xs tabular-nums">{areaLabel}</span>
        ) : (
          <>
            <span className="sr-only">Area unavailable</span>
            <span aria-hidden="true" className="text-white/60 text-xs">
              —
            </span>
          </>
        )}
      </div>
    </div>
  );
}
