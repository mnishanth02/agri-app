import type { FieldDto } from '@viz-crop/shared';

import { FieldCard } from '@/components/dashboard/FieldCard';

/**
 * Responsive grid of `FieldCard`s. Stable key on `field.id` — never index —
 * so React preserves card-local UI state (open dialogs, mid-edit input) when
 * the underlying list reorders or filters.
 */
export function FieldList({ fields }: { fields: FieldDto[] }) {
  return (
    <ul
      data-slot="dashboard-field-list"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {fields.map((field) => (
        <li key={field.id}>
          <FieldCard field={field} />
        </li>
      ))}
    </ul>
  );
}
