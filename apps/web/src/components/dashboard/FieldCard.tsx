import { Link } from '@tanstack/react-router';
import type { FieldDto } from '@viz-crop/shared';
import { formatDistanceToNow } from 'date-fns';
import { MoreVerticalIcon, PencilIcon, SquareArrowOutUpRightIcon, TrashIcon } from 'lucide-react';
import { type FormEvent, type MouseEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDeleteField, useUpdateField } from '@/hooks/useFields';
import { ApiError } from '@/lib/api';

/**
 * Dashboard field card. Renders one `FieldDto` with:
 *
 * - Title that links to `/fields/$id` (only the title is the link target — see
 *   plan-1.8.md rationale: a whole-card `<Link>` would conflict with the kebab
 *   trigger and `div onClick` is an a11y regression).
 * - Crop / season / area / "updated x ago" metadata.
 * - Kebab `DropdownMenu` with Open / Rename / Delete.
 *
 * The Rename `Dialog` and Delete `AlertDialog` are rendered as **siblings** of
 * the dropdown (not children of `DropdownMenuContent`) so the dropdown's
 * unmount when the menu closes does not also unmount the dialog. Dialog open
 * state is owned by this component.
 */
export function FieldCard({ field }: { field: FieldDto }) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <Card data-slot="field-card" className="overflow-hidden">
        <CardHeader>
          <CardTitle className="truncate text-base">
            <Link
              to="/fields/$id"
              params={{ id: field.id }}
              className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 hover:underline"
              aria-label={`Open field ${field.name}`}
            >
              {field.name}
            </Link>
          </CardTitle>
          <CardDescription className="truncate">
            {field.cropType} · {field.season}
          </CardDescription>

          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Field actions for ${field.name}`}
                >
                  <MoreVerticalIcon className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem asChild>
                  <Link to="/fields/$id" params={{ id: field.id }}>
                    <SquareArrowOutUpRightIcon className="size-4" aria-hidden="true" />
                    Open
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
                  <PencilIcon className="size-4" aria-hidden="true" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                  <TrashIcon className="size-4" aria-hidden="true" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        </CardHeader>

        <CardContent className="text-sm">
          <dl className="grid grid-cols-2 gap-y-1">
            <dt className="text-muted-foreground">Area</dt>
            <dd className="text-right font-medium">
              {field.areaHectares !== null ? (
                `${field.areaHectares.toFixed(2)} ha`
              ) : (
                <span className="text-muted-foreground">Area unavailable</span>
              )}
            </dd>
          </dl>
        </CardContent>

        <CardFooter className="border-t pt-4 text-xs text-muted-foreground">
          Updated {formatDistanceToNow(new Date(field.updatedAt), { addSuffix: true })}
        </CardFooter>
      </Card>

      <RenameDialog field={field} open={renameOpen} onOpenChange={setRenameOpen} />
      <DeleteAlert field={field} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  );
}

/**
 * Controlled rename dialog. Sends `PATCH /api/fields/:id { name }` via
 * `useUpdateField`. Inline trim + length guard avoids a server round-trip for
 * obvious validation failures (server enforces the same bounds via
 * `updateFieldDto`).
 *
 * `useUpdateField` already does
 * `setQueryData(detail) + setQueryData(list, map) + invalidate(list)`, so the
 * dashboard card re-renders with the new name synchronously when the dialog
 * closes — no extra cache work needed here.
 */
function RenameDialog({
  field,
  open,
  onOpenChange,
}: {
  field: FieldDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(field.name);
  const updateMutation = useUpdateField(field.id);

  // Reset the input when the dialog (re)opens or the underlying field name
  // changes (e.g. external rename via another tab).
  useEffect(() => {
    if (open) setName(field.name);
  }, [open, field.name]);

  const trimmed = name.trim();
  const isUnchanged = trimmed === field.name;
  const isInvalid = trimmed.length === 0 || trimmed.length > 120;
  const canSubmit = !isInvalid && !isUnchanged && !updateMutation.isPending;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    updateMutation.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          toast.success('Field renamed');
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error('Could not rename field', {
            description:
              error instanceof ApiError ? `${error.status} ${error.statusText}` : error.message,
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename field</DialogTitle>
          <DialogDescription>
            Update the display name for this field. Geometry and other metadata are unchanged.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`rename-${field.id}`}>Field name</Label>
            <Input
              id={`rename-${field.id}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              autoFocus
              aria-invalid={isInvalid}
              aria-describedby={isInvalid ? `rename-${field.id}-error` : undefined}
            />
            {isInvalid ? (
              <p id={`rename-${field.id}-error`} className="text-xs text-destructive">
                Name must be 1–120 characters.
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {updateMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Controlled delete confirmation. The `AlertDialogAction` calls
 * `event.preventDefault()` so the dialog does NOT close on click — we close
 * it manually inside the mutation's `onSuccess` callback. This is what makes
 * `disabled={isPending}` actually do its job: without `preventDefault()`,
 * Radix would close the dialog immediately and a second click on the now-
 * dismissed alert would never reach the disabled-button guard.
 */
function DeleteAlert({
  field,
  open,
  onOpenChange,
}: {
  field: FieldDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const deleteMutation = useDeleteField(field.id);

  const handleConfirm = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success('Field deleted');
        onOpenChange(false);
      },
      onError: (error) => {
        toast.error('Could not delete field', {
          description:
            error instanceof ApiError ? `${error.status} ${error.statusText}` : error.message,
        });
      },
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{field.name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the field and all cached satellite scenes and NDVI stats. This
            action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={deleteMutation.isPending}
            className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20"
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
