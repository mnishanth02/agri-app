/**
 * Module 5.6 — `DateTimeline` (visual stub).
 *
 * Bottom-centre horizontal strip of date chips with scroll arrows and a
 * "Next image" hint at the right. Phase 6 wires this to real Sentinel-2
 * scenes from `useEosdaScenes(fieldId)`; until then the chips are
 * placeholders.
 *
 * Anchored at `bottom-20` always — the BottomBar is now a corner tray
 * (see § R.B.6), so the timeline no longer has to clear its expanded
 * state.
 */

import { ChevronLeftIcon, ChevronRightIcon, CloudIcon } from 'lucide-react';
import { useRef } from 'react';
import { CHIP_BASE, CHIP_FOCUS } from '@/lib/tokens';
import { cn } from '@/lib/utils';

type ScenePlaceholder = {
  id: string;
  day: string;
  year: string;
  isCurrent: boolean;
  cloudy: boolean;
};

const SCENES: ReadonlyArray<ScenePlaceholder> = [
  { id: 's1', day: '26 Feb', year: "'26", isCurrent: false, cloudy: false },
  { id: 's2', day: '03 Mar', year: "'26", isCurrent: false, cloudy: true },
  { id: 's3', day: '13 Mar', year: "'26", isCurrent: false, cloudy: false },
  { id: 's4', day: '23 Mar', year: "'26", isCurrent: false, cloudy: false },
  { id: 's5', day: '02 Apr', year: "'26", isCurrent: false, cloudy: true },
  { id: 's6', day: '12 Apr', year: "'26", isCurrent: false, cloudy: false },
  { id: 's7', day: '17 Apr', year: "'26", isCurrent: false, cloudy: false },
  { id: 's8', day: '22 Apr', year: "'26", isCurrent: false, cloudy: false },
  { id: 's9', day: '27 Apr', year: "'26", isCurrent: true, cloudy: false },
];

const NEXT_IMAGE_HINT = '7 May';

export function DateTimeline() {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollBy = (direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * 160, behavior: 'smooth' });
  };

  return (
    <div className="pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2">
      <div
        className={cn(
          CHIP_BASE,
          'pointer-events-auto flex h-10 items-center gap-1 px-1.5',
          'w-[min(720px,calc(100vw-1.5rem))]',
        )}
      >
        <button
          type="button"
          aria-label="Earlier scenes"
          onClick={() => scrollBy(-1)}
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white',
            CHIP_FOCUS,
          )}
        >
          <ChevronLeftIcon aria-hidden="true" className="size-4" />
        </button>

        <div
          ref={scrollRef}
          role="toolbar"
          aria-label="Recent scenes"
          aria-orientation="horizontal"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {SCENES.map((scene) => (
            <button
              key={scene.id}
              type="button"
              aria-pressed={scene.isCurrent}
              aria-label={`${scene.day} ${scene.year}${scene.cloudy ? ' (cloudy)' : ''}`}
              className={cn(
                'relative inline-flex h-9 w-12 shrink-0 flex-col items-center justify-center rounded-md font-medium text-[10px] text-white/75 leading-tight transition-colors',
                'hover:bg-white/10 hover:text-white',
                CHIP_FOCUS,
                scene.isCurrent &&
                  'bg-emerald-400/20 text-white ring-1 ring-emerald-300 ring-inset',
              )}
            >
              <span>{scene.day}</span>
              <span className="text-white/50">{scene.year}</span>
              {scene.cloudy ? (
                <CloudIcon
                  aria-hidden="true"
                  className="absolute top-0.5 right-0.5 size-3 text-white/60"
                />
              ) : null}
            </button>
          ))}
        </div>

        <button
          type="button"
          aria-label="Later scenes"
          onClick={() => scrollBy(1)}
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white',
            CHIP_FOCUS,
          )}
        >
          <ChevronRightIcon aria-hidden="true" className="size-4" />
        </button>

        <span
          aria-hidden="true"
          className="ml-1 hidden h-6 shrink-0 items-center rounded-md border border-white/10 bg-white/5 px-2 text-[10px] text-white/55 sm:inline-flex"
        >
          Next: {NEXT_IMAGE_HINT}
        </span>
        <span className="sr-only">Next image expected {NEXT_IMAGE_HINT}.</span>
      </div>
    </div>
  );
}
