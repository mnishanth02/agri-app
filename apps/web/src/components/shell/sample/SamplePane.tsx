/**
 * Module 7.3 — Sample sidebar pane.
 *
 * Renders the per-scene NDVI/EVI/NDWI zonal statistics for the field's
 * currently selected scene. Driven by `useEosdaStats` (Module 7.2)
 * + `useUiStore.selectedViewId` + `useUiStore.selectedIndex`.
 *
 * UI state matrix (mirrors the table in plan.md):
 *
 *   1. No scene selected            → "Pick a scene from the timeline"
 *   2. Scenes loading               → skeleton (auto-select runs in parallel)
 *   3. Stats computing first time   → skeleton + "Computing… (~30s)"
 *   4. Stats retrying after 504     → skeleton + "Still computing…"
 *   5. Final error after retry      → inline error pill + Retry button
 *   6. No scenes for range          → "No Sentinel-2 scenes for this range"
 *   7. No stats for (viewId, index) → "Stats unavailable for this scene"
 *   8. Happy path                   → mean / p10 / p90 / median / cloud / coverage
 *
 * Schema: pulls only the persisted columns. EOSDA `mt_stats` returns
 * `std`, `variance`, `q1`, `q3` too but `cached_ndvi_stats` has no
 * columns for them (intentional v2 deviation; see Module 7.1's note).
 * Mini-histogram is also deferred per the plan.
 */
import type { FieldDto, NdviStatsDto } from '@viz-crop/shared';
import { Loader2, RefreshCcw } from 'lucide-react';
import { useEosdaScenes } from '@/hooks/useEosdaScenes';
import { useEosdaStats } from '@/hooks/useEosdaStats';
import { getNdviColor, NDVI_COLOR_CLASSES, type NdviColorKey } from '@/lib/ndvi-colors';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/useUiStore';

interface SamplePaneProps {
  field: FieldDto;
}

export function SamplePane({ field }: SamplePaneProps) {
  const selectedViewId = useUiStore((s) => s.selectedViewId);
  const selectedIndex = useUiStore((s) => s.selectedIndex);

  const scenesQuery = useEosdaScenes(field.id);
  const statsQuery = useEosdaStats({ fieldId: field.id, indexes: [selectedIndex] });

  const isStatsRetrying = statsQuery.isFetching && statsQuery.failureCount > 0;
  const noScenesForRange =
    scenesQuery.isSuccess &&
    (scenesQuery.data?.length === 0 || statsQuery.data?.error === 'NO_SCENES_FOR_RANGE');

  const matchingRow = pickStatsRow(statsQuery.data?.stats ?? [], selectedViewId, selectedIndex);

  return (
    <section
      data-pane="sample"
      aria-label={`${selectedIndex} sample stats`}
      className="flex flex-col gap-3"
    >
      <Header field={field} index={selectedIndex} />

      {scenesQuery.isPending ? (
        <SkeletonBody hint="Loading scenes…" />
      ) : scenesQuery.isError ? (
        <ErrorState
          message="Could not load scenes."
          isFetching={scenesQuery.isFetching}
          onRetry={() => void scenesQuery.refetch()}
        />
      ) : noScenesForRange ? (
        <EmptyState
          title="No Sentinel-2 scenes"
          body="No usable scenes for the last 90 days. Try again after the next satellite pass (~5 days)."
        />
      ) : selectedViewId === null ? (
        <EmptyState
          title="Pick a scene"
          body={`Select a date from the timeline below to see ${selectedIndex} statistics for the field.`}
        />
      ) : statsQuery.isFetching ? (
        <SkeletonBody hint={isStatsRetrying ? 'Still computing…' : 'Computing… (~30s)'} />
      ) : statsQuery.isError ? (
        <ErrorState
          message="Could not load statistics."
          isFetching={statsQuery.isFetching}
          onRetry={() => void statsQuery.refetch()}
        />
      ) : matchingRow ? (
        <StatsBody row={matchingRow} />
      ) : (
        <EmptyState
          title="Stats unavailable"
          body="EOSDA returned no usable pixels for this scene (likely full cloud cover). Try a nearby date."
        />
      )}
    </section>
  );
}

interface HeaderProps {
  field: FieldDto;
  index: string;
}

function Header({ field, index }: HeaderProps) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-white/60 text-xs uppercase tracking-wide">
        {index} sample · {field.name}
      </p>
    </div>
  );
}

function SkeletonBody({ hint }: { hint: string }) {
  return (
    <output
      className="flex flex-col gap-2 rounded-md border border-white/10 bg-white/[0.03] p-3"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-white/70 text-xs">
        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        <span>{hint}</span>
      </div>
      <div className="space-y-2">
        <div className="h-3 w-3/4 animate-pulse rounded bg-white/10" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-white/10" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-white/10" />
      </div>
    </output>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-white/10 border-dashed bg-white/[0.03] px-3 py-6 text-center">
      <p className="font-medium text-sm text-white/85">{title}</p>
      <p className="mt-1 text-balance text-white/60 text-xs">{body}</p>
    </div>
  );
}

function ErrorState({
  message,
  isFetching,
  onRetry,
}: {
  message: string;
  isFetching: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-3">
      <p className="font-medium text-red-200 text-sm">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={isFetching}
        aria-busy={isFetching || undefined}
        className="inline-flex w-fit items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-red-100 text-xs hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isFetching ? (
          <Loader2 aria-hidden="true" className="size-3 animate-spin" />
        ) : (
          <RefreshCcw aria-hidden="true" className="size-3" />
        )}
        {isFetching ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}

interface StatsBodyProps {
  row: NdviStatsDto;
}

function StatsBody({ row }: StatsBodyProps) {
  const meanColor = getNdviColor(row.mean);
  return (
    <div className="flex flex-col gap-3 rounded-md border border-white/10 bg-white/[0.03] p-3">
      <PrimaryStat label="Mean" value={row.mean} color={meanColor} />
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <SecondaryStat label="p10" value={row.p10} />
        <SecondaryStat label="Median" value={row.median} />
        <SecondaryStat label="p90" value={row.p90} />
        <SecondaryStat label="Min" value={row.min} />
        <SecondaryStat label="Max" value={row.max} />
      </div>
      <Confidence cloud={row.cloudPercent} coverage={row.dataCoveragePercent} />
    </div>
  );
}

function PrimaryStat({
  label,
  value,
  color,
}: {
  label: string;
  value: number | null;
  color: NdviColorKey;
}) {
  const tone = NDVI_COLOR_CLASSES[color];
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className={cn('size-3 rounded-full', tone.bg)} />
      <div className="flex flex-1 items-baseline justify-between gap-3">
        <span className="text-white/60 text-xs uppercase tracking-wide">{label}</span>
        <span className={cn('font-semibold text-2xl tabular-nums', tone.text)}>
          {formatScalar(value)}
        </span>
      </div>
    </div>
  );
}

function SecondaryStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-white/60 text-xs uppercase tracking-wide">{label}</span>
      <span className="font-medium text-sm text-white tabular-nums">{formatScalar(value)}</span>
    </div>
  );
}

function Confidence({ cloud, coverage }: { cloud: number | null; coverage: number | null }) {
  return (
    <div className="border-t border-white/10 pt-2">
      <p className="mb-1 text-white/60 text-xs uppercase tracking-wide">Confidence</p>
      <div className="grid grid-cols-2 gap-x-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-white/70 text-xs">Cloud</span>
          <span className="font-medium text-sm text-white tabular-nums">
            {formatPercent(cloud)}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-white/70 text-xs">Coverage</span>
          <span className="font-medium text-sm text-white tabular-nums">
            {formatPercent(coverage)}
          </span>
        </div>
      </div>
    </div>
  );
}

function pickStatsRow(
  stats: ReadonlyArray<NdviStatsDto>,
  selectedViewId: string | null,
  selectedIndex: string,
): NdviStatsDto | null {
  if (selectedViewId === null) return null;
  for (const row of stats) {
    if (row.viewId === selectedViewId && row.indexName === selectedIndex) {
      // Tombstone rows (every scalar is null because mt_stats returned
      // no usable pixels for this scene — typically 100 % cloud) are
      // intentionally NOT rendered as a "row" to the user; the empty
      // state explains *why* there are no numbers instead of showing
      // a wall of em-dashes that look like a load failure.
      if (isTombstoneRow(row)) return null;
      return row;
    }
  }
  return null;
}

function isTombstoneRow(row: NdviStatsDto): boolean {
  return (
    row.mean === null &&
    row.min === null &&
    row.max === null &&
    row.p10 === null &&
    row.p90 === null &&
    row.median === null
  );
}

function formatScalar(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(0)}%`;
}
