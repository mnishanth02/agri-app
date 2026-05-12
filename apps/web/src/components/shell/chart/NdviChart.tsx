/**
 * Module 7.4 — Chart tab.
 *
 * Renders the per-field NDVI / EVI / NDWI time series for the
 * currently-selected vegetation index. Driven by the same
 * `useEosdaStats` hook that powers the Sample sidebar pane (Module
 * 7.3) and the same `useEosdaScenes` hook that powers the date
 * timeline (Module 6.4) so cache-share is automatic.
 *
 * One series, one point per scene (best-per-date). Color thresholds
 * are shared with the Sample pane through `getNdviColor`. Tombstone
 * scenes (`mean === null`) are dropped from the series — they
 * represent full-cloud passes with no usable pixels.
 *
 * Click a dot → `useUiStore.setSelectedViewId` so the rest of the
 * app (raster overlay, sample stats) jumps to that scene.
 */
import type { FieldDto, NdviStatsDto, SceneDto } from '@viz-crop/shared';
import { Loader2, RefreshCcw } from 'lucide-react';
import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useEosdaScenes } from '@/hooks/useEosdaScenes';
import { useEosdaStats } from '@/hooks/useEosdaStats';
import { getNdviColor, NDVI_COLOR_CLASSES } from '@/lib/ndvi-colors';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/useUiStore';

interface NdviChartProps {
  field: FieldDto;
}

interface ChartPoint {
  viewId: string;
  sceneDate: string;
  /** Excludes tombstones — `null` rows are filtered out before rendering. */
  mean: number;
  cloudPercent: number | null;
}

const CHART_HEIGHT = 240;

export function NdviChart({ field }: NdviChartProps) {
  const selectedIndex = useUiStore((s) => s.selectedIndex);
  const selectedViewId = useUiStore((s) => s.selectedViewId);
  const setSelectedViewId = useUiStore((s) => s.setSelectedViewId);

  const scenesQuery = useEosdaScenes(field.id);
  const statsQuery = useEosdaStats({ fieldId: field.id, indexes: [selectedIndex] });

  const isStatsRetrying = statsQuery.isFetching && statsQuery.failureCount > 0;
  const noScenesForRange =
    scenesQuery.isSuccess &&
    (scenesQuery.data?.length === 0 || statsQuery.data?.error === 'NO_SCENES_FOR_RANGE');

  const chartData = useMemo<ChartPoint[]>(() => {
    if (!scenesQuery.data || !statsQuery.data) return [];
    return buildSeries(scenesQuery.data, statsQuery.data.stats, selectedIndex);
  }, [scenesQuery.data, statsQuery.data, selectedIndex]);

  let body: React.ReactNode;
  if (scenesQuery.isPending) {
    body = <ChartSkeleton hint="Loading scenes…" />;
  } else if (scenesQuery.isError) {
    body = (
      <ChartMessage
        tone="error"
        title="Could not load scenes"
        actionLabel="Retry"
        isFetching={scenesQuery.isFetching}
        onAction={() => void scenesQuery.refetch()}
      />
    );
  } else if (noScenesForRange) {
    body = (
      <ChartMessage
        tone="info"
        title="No Sentinel-2 scenes"
        body="No usable scenes for the last 90 days."
      />
    );
  } else if (statsQuery.isFetching) {
    body = <ChartSkeleton hint={isStatsRetrying ? 'Still computing…' : 'Computing… (~30s)'} />;
  } else if (statsQuery.isError) {
    body = (
      <ChartMessage
        tone="error"
        title="Could not load statistics"
        actionLabel="Retry"
        isFetching={statsQuery.isFetching}
        onAction={() => void statsQuery.refetch()}
      />
    );
  } else if (chartData.length === 0) {
    body = (
      <ChartMessage
        tone="info"
        title="No usable values"
        body="EOSDA returned no clear-sky pixels for the selected scenes."
      />
    );
  } else {
    body = (
      <NdviChartCanvas
        data={chartData}
        index={selectedIndex}
        selectedViewId={selectedViewId}
        onSelectViewId={setSelectedViewId}
      />
    );
  }

  return (
    <section
      data-pane="chart"
      aria-label={`${selectedIndex} time series for ${field.name}`}
      className="flex h-full min-h-[200px] flex-col gap-2"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-white/60 text-xs uppercase tracking-wide">
          {selectedIndex} trend · {field.name}
        </p>
        {chartData.length > 0 && <p className="text-white/55 text-xs">{chartData.length} scenes</p>}
      </div>
      <div className="min-h-0 flex-1">{body}</div>
    </section>
  );
}

interface NdviChartCanvasProps {
  data: ReadonlyArray<ChartPoint>;
  index: string;
  selectedViewId: string | null;
  onSelectViewId: (viewId: string) => void;
}

function NdviChartCanvas({ data, index, selectedViewId, onSelectViewId }: NdviChartCanvasProps) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <LineChart data={data as ChartPoint[]} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
        <XAxis
          dataKey="sceneDate"
          tickFormatter={formatDateTick}
          stroke="rgba(255,255,255,0.5)"
          tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
          minTickGap={32}
        />
        <YAxis
          domain={getYDomain(index)}
          stroke="rgba(255,255,255,0.5)"
          tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
          width={36}
          tickFormatter={(v: number) => v.toFixed(1)}
        />
        <Tooltip
          cursor={{ stroke: 'rgba(255,255,255,0.2)', strokeDasharray: '3 3' }}
          content={<NdviTooltip indexLabel={index} />}
        />
        <Line
          type="monotone"
          dataKey="mean"
          stroke="rgba(255,255,255,0.45)"
          strokeWidth={1.5}
          isAnimationActive={false}
          activeDot={false}
          dot={(dotProps: unknown) => {
            const {
              cx,
              cy,
              payload,
              index: pointIndex,
            } = dotProps as {
              cx?: number;
              cy?: number;
              payload?: ChartPoint;
              index: number;
            };
            if (
              !payload ||
              cx === undefined ||
              cy === undefined ||
              !Number.isFinite(cx) ||
              !Number.isFinite(cy)
            ) {
              // recharts will call the dot renderer with NaN cx/cy for any
              // point whose value is null. Returning an empty <g/> is the
              // documented escape hatch (returning `null` triggers the
              // "valid React element" warning).
              return <g key={`dot-empty-${pointIndex}`} />;
            }
            const tone = NDVI_COLOR_CLASSES[getNdviColor(payload.mean)];
            const isSelected = payload.viewId === selectedViewId;
            return (
              <g key={`dot-${payload.viewId}`}>
                {isSelected && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={9}
                    fill="none"
                    stroke="rgba(255,255,255,0.8)"
                    strokeWidth={1.5}
                    pointerEvents="none"
                  />
                )}
                {/* biome-ignore lint/a11y/noStaticElementInteractions: SVG <circle> dots are not focusable; the DateTimeline chips provide the keyboard-accessible scene picker. The aria-label here keeps assistive tech informed of the value. */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={isSelected ? 5.5 : 4}
                  fill={tone.hex}
                  stroke="rgba(0,0,0,0.45)"
                  strokeWidth={1}
                  cursor="pointer"
                  aria-label={`${payload.sceneDate} — ${payload.mean.toFixed(2)}`}
                  onClick={() => onSelectViewId(payload.viewId)}
                />
              </g>
            );
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

interface NdviTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ChartPoint }>;
  indexLabel: string;
}

function NdviTooltip({ active, payload, indexLabel }: NdviTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  const tone = NDVI_COLOR_CLASSES[getNdviColor(point.mean)];
  return (
    <div className="rounded-md border border-white/10 bg-slate-950/95 px-2.5 py-1.5 text-white/85 text-xs shadow-lg">
      <p className="font-medium">{point.sceneDate}</p>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span aria-hidden="true" className={cn('inline-block size-2 rounded-full', tone.bg)} />
        <span className="font-semibold tabular-nums">
          {indexLabel} {point.mean.toFixed(2)}
        </span>
      </div>
      {point.cloudPercent !== null && Number.isFinite(point.cloudPercent) && (
        <p className="mt-0.5 text-white/55">Cloud {point.cloudPercent.toFixed(0)}%</p>
      )}
    </div>
  );
}

function ChartSkeleton({ hint }: { hint: string }) {
  return (
    <output
      aria-live="polite"
      className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2"
    >
      <Loader2 aria-hidden="true" className="size-5 animate-spin text-white/60" />
      <p className="text-white/70 text-xs">{hint}</p>
    </output>
  );
}

interface ChartMessageProps {
  tone: 'info' | 'error';
  title: string;
  body?: string;
  actionLabel?: string;
  isFetching?: boolean;
  onAction?: () => void;
}

function ChartMessage({ tone, title, body, actionLabel, isFetching, onAction }: ChartMessageProps) {
  const isError = tone === 'error';
  return (
    <div
      className={cn(
        'flex h-full min-h-[200px] flex-col items-center justify-center gap-2 px-4 text-center',
        isError && 'text-red-200',
      )}
    >
      <p className={cn('font-medium text-sm', isError ? 'text-red-100' : 'text-white/85')}>
        {title}
      </p>
      {body && <p className="text-balance text-white/55 text-xs">{body}</p>}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          disabled={isFetching}
          aria-busy={isFetching || undefined}
          className={cn(
            'mt-1 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
            isError
              ? 'border-red-500/40 bg-red-500/10 text-red-100 hover:bg-red-500/20'
              : 'border-white/15 bg-white/5 text-white hover:bg-white/10',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          {isFetching ? (
            <Loader2 aria-hidden="true" className="size-3 animate-spin" />
          ) : (
            <RefreshCcw aria-hidden="true" className="size-3" />
          )}
          {isFetching ? 'Retrying…' : actionLabel}
        </button>
      )}
    </div>
  );
}

function buildSeries(
  scenes: ReadonlyArray<SceneDto>,
  stats: ReadonlyArray<NdviStatsDto>,
  index: string,
): ChartPoint[] {
  const sceneByViewId = new Map<string, SceneDto>();
  for (const s of scenes) sceneByViewId.set(s.viewId, s);

  const points: ChartPoint[] = [];
  for (const row of stats) {
    if (row.indexName !== index) continue;
    if (row.mean === null || !Number.isFinite(row.mean)) continue;
    const scene = sceneByViewId.get(row.viewId);
    if (!scene) continue;
    points.push({
      viewId: row.viewId,
      sceneDate: scene.sceneDate.slice(0, 10),
      mean: row.mean,
      cloudPercent: row.cloudPercent ?? scene.cloudPercent,
    });
  }
  points.sort((a, b) => a.sceneDate.localeCompare(b.sceneDate));
  return points;
}

function getYDomain(index: string): [number, number] {
  // NDVI / EVI are bounded [-1, 1]; NDWI similarly. Fix the scale so
  // the line keeps a stable baseline as the user toggles indexes
  // rather than auto-fitting and visually inflating noise.
  return index === 'NDWI' ? [-1, 1] : [-0.2, 1];
}

function formatDateTick(value: string): string {
  if (!value) return '';
  // sceneDate is ISO YYYY-MM-DD per shared zod; show MMM DD.
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  const monthIdx = Number.parseInt(month, 10) - 1;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[monthIdx] ?? month} ${Number.parseInt(day, 10)}`;
}
