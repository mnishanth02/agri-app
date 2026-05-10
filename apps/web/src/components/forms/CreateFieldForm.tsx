/**
 * Module 3.5 — `CreateFieldForm`
 *
 * The form column for `/fields/new`. Wired by Module 3.6's `CreateLayout`;
 * this module ships the component only.
 *
 * ## Form ↔ map decoupling (spec line 536)
 *
 * The form lives in its own subtree. It does **not** import or render anything
 * from `@/components/map` and it does **not** receive form values as props
 * from the map column. The draft polygon is sourced from `useFieldStore`
 * (Zustand) instead of `react-hook-form`, so:
 *
 * - Typing in any input never re-renders the map subtree.
 * - Drawing on the map never triggers RHF re-validation.
 * - Multi-slice store reads use `useShallow` so this component only
 *   re-renders when the polygon, area, valid flag, or errors actually
 *   change — not on unrelated store writes (`currentFieldId`, etc.).
 *
 * ## Why `mode: 'onChange'`
 *
 * The submit button's `disabled` predicate depends on `formState.isValid`,
 * `draftPolygon != null`, `draftValid`, and `mutation.isPending`. With the
 * default `mode: 'onSubmit'`, `isValid` only flips after the first submit
 * attempt and the button would stay enabled too long. `'onChange'` keeps the
 * button in lock-step with the form contents.
 *
 * ## Why navigate-then-clearDraft on success (spec line 541)
 *
 * `clearDraft()` removes `draftPolygon`, which makes `<FieldLayer />`
 * (Module 3.3) erase the polygon from the map. If we cleared first, the user
 * would see a brief empty Karnataka basemap on `/fields/new` while TanStack
 * Router tears down the route and mounts `/fields/$id`. Navigating first
 * shows the destination route immediately; the unmount of `/fields/new`
 * then disposes the draft layer. Clearing AFTER `await navigate(...)` keeps
 * both behaviors — no polygon leak into the next `/fields/new` visit, no
 * flash here.
 *
 * ## Form schema vs API DTO
 *
 * `createFieldDto` (the API contract) treats optional metadata as
 * `present-or-absent`: `metadataString.optional()` accepts `undefined` but
 * NOT `''`. If we used `createFieldDto.omit({ geometry: true })` directly as
 * the resolver, an empty `farmerName` field would make the whole form
 * invalid the moment the user erased a typo.
 *
 * The form therefore validates against a wider local `formSchema` that
 * accepts empty strings for optional metadata. On submit we:
 *
 * 1. Trim and convert empty optional metadata strings to `undefined`.
 * 2. Trim the required `name`.
 * 3. Assemble `{ ...payload, geometry: draftPolygon }`.
 * 4. Re-validate against `createFieldDto.safeParse(...)` for a final
 *    contract guard before calling `useCreateField().mutateAsync(...)`.
 *
 * `cropType` and `season` start as `undefined` so the user is forced to pick
 * one — `formState.isValid` stays `false` until they do.
 *
 * `sowingDate` from the canonical schema is intentionally not rendered: the
 * spec (line 537) does not list it among the form fields. The API accepts
 * the omission because `sowingDate` is `.optional()` in `createFieldDto`.
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { createFieldDto, cropTypeEnum, seasonEnum } from '@viz-crop/shared';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCreateField } from '@/hooks/useFields';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useFieldStore } from '@/stores/useFieldStore';

const optionalMetadata = z.string().max(120).optional();

const formSchema = z.object({
  name: z.string().trim().min(1).max(120),
  cropType: cropTypeEnum,
  season: seasonEnum,
  farmerName: optionalMetadata,
  village: optionalMetadata,
  district: optionalMetadata,
  state: optionalMetadata,
});

type FormValues = z.infer<typeof formSchema>;

function normalizeMetadata(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function pickServerMessage(error: ApiError): string | null {
  const body = error.body;
  if (body && typeof body === 'object' && 'message' in body) {
    const msg = (body as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.length > 0) return msg;
  }
  return null;
}

function chipClasses(hasArea: boolean, valid: boolean): string {
  if (!hasArea) {
    return 'border-border bg-muted text-muted-foreground';
  }
  if (valid) {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  }
  return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300';
}

export function CreateFieldForm() {
  const navigate = useNavigate();
  const createMutation = useCreateField();

  const { draftPolygon, draftValid, draftErrors, draftAreaHectares } = useFieldStore(
    useShallow((s) => ({
      draftPolygon: s.draftPolygon,
      draftValid: s.draftValid,
      draftErrors: s.draftErrors,
      draftAreaHectares: s.draftAreaHectares,
    })),
  );
  const clearDraft = useFieldStore((s) => s.clearDraft);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: {
      name: '',
      // cropType / season intentionally start undefined so the user must
      // pick a value before the form becomes valid. Cast keeps the
      // inferred FormValues type strict everywhere else (field.value is
      // typed as the enum, runtime is undefined until first selection).
      cropType: undefined as unknown as FormValues['cropType'],
      season: undefined as unknown as FormValues['season'],
      farmerName: '',
      village: '',
      district: '',
      state: '',
    },
  });

  const isSubmitDisabled =
    !form.formState.isValid || draftPolygon === null || !draftValid || createMutation.isPending;

  const onSubmit = async (values: FormValues) => {
    // Mirror the submit-button disabled predicate inside the handler so a
    // form submit event reaching us by a path that bypasses the button
    // (Enter key during a transient pending window, programmatic submit,
    // double-fire) cannot produce a duplicate POST. The disabled attribute
    // is a UI guard, not a submit invariant.
    if (createMutation.isPending || draftPolygon === null || !draftValid) {
      return;
    }

    const payload = {
      name: values.name.trim(),
      cropType: values.cropType,
      season: values.season,
      farmerName: normalizeMetadata(values.farmerName),
      village: normalizeMetadata(values.village),
      district: normalizeMetadata(values.district),
      state: normalizeMetadata(values.state),
      geometry: draftPolygon,
    };

    const parsed = createFieldDto.safeParse(payload);
    if (!parsed.success) {
      // Should be unreachable given the form-level resolver + draftValid
      // gate. If it ever fires, surface it for debugging instead of
      // silently calling the mutation with a malformed payload.
      console.error(
        'CreateFieldForm: client-side createFieldDto guard failed',
        parsed.error.issues,
      );
      const first = parsed.error.issues[0];
      form.setError('root', {
        message: first?.message ?? 'Validation failed. Please review the form.',
      });
      return;
    }

    // Create and navigate live in **separate** try/catch blocks so a
    // navigation failure after a successful POST is not surfaced as a
    // create failure — the row already exists, encouraging the user to
    // resubmit would create a duplicate.
    let createdId: string;
    try {
      const result = await createMutation.mutateAsync(parsed.data);
      createdId = result.id;
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        form.setError('root', {
          message:
            pickServerMessage(error) ?? 'The server rejected the field. Please review the form.',
        });
        return;
      }
      form.setError('root', {
        message: 'Could not create field. Please try again.',
      });
      return;
    }

    try {
      // Navigate FIRST so /fields/$id mounts before /fields/new tears down,
      // THEN clear the draft. See file-level JSDoc for the rationale.
      await navigate({ to: '/fields/$id', params: { id: createdId } });
      clearDraft();
    } catch {
      form.setError('root', {
        message: 'Field was created, but navigation failed. Please open it from the dashboard.',
      });
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-tight">New field</h1>
        <p className="text-muted-foreground text-sm">
          Draw your field on the map, then add the details below.
        </p>
      </div>

      <AreaChip areaHectares={draftAreaHectares} valid={draftValid} errors={draftErrors} />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Field name</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g. North paddy"
                    autoComplete="off"
                    maxLength={120}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="cropType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Crop type</FormLabel>
                <Select value={field.value ?? undefined} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a crop" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {cropTypeEnum.options.map((crop) => (
                      <SelectItem key={crop} value={crop}>
                        {crop}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="season"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Season</FormLabel>
                <FormControl>
                  <Tabs value={field.value ?? ''} onValueChange={field.onChange} className="w-full">
                    <TabsList className="grid w-full grid-cols-4">
                      {seasonEnum.options.map((season) => (
                        <TabsTrigger key={season} value={season}>
                          {season}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <fieldset className="flex flex-col gap-4 rounded-md border p-4">
            <legend className="px-1 text-muted-foreground text-sm">Optional details</legend>

            <FormField
              control={form.control}
              name="farmerName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Farmer name</FormLabel>
                  <FormControl>
                    <Input maxLength={120} autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="village"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Village</FormLabel>
                  <FormControl>
                    <Input maxLength={120} autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="district"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>District</FormLabel>
                  <FormControl>
                    <Input maxLength={120} autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="state"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>State</FormLabel>
                  <FormControl>
                    <Input maxLength={120} autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </fieldset>

          {form.formState.errors.root ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive text-sm"
            >
              {form.formState.errors.root.message}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={isSubmitDisabled}>
            {createMutation.isPending ? 'Creating…' : 'Create Field'}
          </Button>
        </form>
      </Form>
    </div>
  );
}

function AreaChip({
  areaHectares,
  valid,
  errors,
}: {
  areaHectares: number | null;
  valid: boolean;
  errors: string[];
}) {
  const hasArea = areaHectares !== null && areaHectares > 0;

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          'inline-flex items-center gap-2 self-start rounded-full border px-3 py-1 text-sm',
          chipClasses(hasArea, valid),
        )}
        aria-live="polite"
      >
        {hasArea ? (
          <>
            <span
              aria-hidden="true"
              className={cn('size-2 rounded-full', valid ? 'bg-emerald-500' : 'bg-amber-500')}
            />
            <span>{areaHectares.toFixed(2)} ha</span>
          </>
        ) : (
          <span>Draw a polygon to see area</span>
        )}
      </div>
      {errors.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-amber-700 text-xs dark:text-amber-300">
          {errors.map((err) => (
            <li key={err}>• {err}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
