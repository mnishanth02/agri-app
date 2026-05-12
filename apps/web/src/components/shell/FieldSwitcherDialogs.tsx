/**
 * Module 8.2 — Rename + delete dialogs colocated with `FieldSwitcherChip`.
 *
 * Mirrors the dashboard `FieldCard` pattern: the dialogs are owned by the
 * parent (the chip) and rendered as **siblings** of the dropdown rather
 * than children of `DropdownMenuContent`. Radix unmounts dropdown content
 * when the menu closes, which would unmount any dialog living inside it
 * and abort the in-flight mutation. Hoisting state up keeps the dialog
 * alive across the dropdown close that fires on `DropdownMenuItem`
 * select.
 */

import { useNavigate } from '@tanstack/react-router';
import type { FieldDto } from '@viz-crop/shared';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDeleteField, useUpdateField } from '@/hooks/useFields';
import { notifyError } from '@/lib/notify';

export function FieldRenameDialog({
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
          notifyError(error, { fallback: 'Could not rename field' });
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
            <Label htmlFor={`switcher-rename-${field.id}`}>Field name</Label>
            <Input
              id={`switcher-rename-${field.id}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              autoFocus
              aria-invalid={isInvalid}
              aria-describedby={isInvalid ? `switcher-rename-${field.id}-error` : undefined}
            />
            {isInvalid ? (
              <p id={`switcher-rename-${field.id}-error`} className="text-xs text-destructive">
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
 * Delete confirmation for the analysis screen. On success we navigate
 * back to the dashboard *before* closing the dialog so the user is not
 * stranded on a `/fields/$id` route whose underlying field has been
 * removed (its `useField` query would refetch and 404 — see
 * `useDeleteField` JSDoc).
 */
export function FieldDeleteAlert({
  field,
  open,
  onOpenChange,
}: {
  field: FieldDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const deleteMutation = useDeleteField(field.id);
  const navigate = useNavigate();

  const handleConfirm = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success('Field deleted');
        onOpenChange(false);
        void navigate({ to: '/' });
      },
      onError: (error) => {
        notifyError(error, { fallback: 'Could not delete field' });
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
