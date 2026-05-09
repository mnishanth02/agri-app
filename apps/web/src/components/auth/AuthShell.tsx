import type * as React from 'react';
import { cn } from '@/lib/utils';

interface AuthShellProps {
  children: React.ReactNode;
  heading: string;
  subheading?: string;
  imageSrc?: string;
  imageAlt?: string;
  tagline?: string;
}

export function AuthShell({
  children,
  heading,
  subheading,
  imageSrc,
  imageAlt = 'Agricultural landscape',
  tagline,
}: AuthShellProps) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Form panel */}
      <div className="flex flex-col items-center justify-center px-6 py-12 lg:px-12">
        <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Logo / brand mark */}
          <div className="mb-8">
            <div className="flex items-center gap-2 text-primary">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-7"
                aria-hidden="true"
              >
                <path d="M11 20A7 7 0 0 1 9.8 6.9C15.5 4.9 17 3.5 17 3.5s1.5 2 2.1 4.7" />
                <path d="M11.2 14c.6-.3 1.1-.7 1.5-1.2" />
                <path d="M14 20.2c0-1.7.7-3.3 1.8-4.5" />
                <path d="M7 20.2c0-2.2 1-4.2 2.5-5.5" />
              </svg>
              <span className="text-lg font-semibold tracking-tight">viz-crop</span>
            </div>
          </div>

          {/* Heading */}
          <div className="mb-6 space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
            {subheading && <p className="text-sm text-muted-foreground">{subheading}</p>}
          </div>

          {/* Form content */}
          {children}
        </div>
      </div>

      {/* Image panel — hidden on mobile */}
      <div className="relative hidden overflow-hidden lg:block">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={imageAlt}
            className={cn(
              'absolute inset-0 h-full w-full object-cover',
              'animate-[ken-burns_25s_ease-in-out_infinite_alternate]',
            )}
          />
        ) : (
          <div
            className={cn(
              'absolute inset-0',
              'bg-linear-to-br from-emerald-800 via-emerald-600 to-lime-500',
              'animate-[ken-burns_25s_ease-in-out_infinite_alternate]',
            )}
          />
        )}

        {/* Overlay */}
        <div className="absolute inset-0 bg-black/30" />

        {/* Tagline */}
        {tagline && (
          <div className="absolute inset-0 flex flex-col items-center justify-end p-12">
            <p className="max-w-sm text-center text-xl font-medium leading-relaxed text-white/90 animate-in fade-in slide-in-from-bottom-2 duration-700 delay-300">
              {tagline}
            </p>
          </div>
        )}

        {/* Decorative dots pattern */}
        <div className="absolute top-8 right-8 grid grid-cols-3 gap-1.5 opacity-40">
          {Array.from({ length: 9 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static decorative dots
            <div key={i} className="size-1.5 rounded-full bg-white" />
          ))}
        </div>
      </div>
    </div>
  );
}
