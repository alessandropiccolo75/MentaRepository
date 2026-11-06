import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/labels";
import type { Priority, StatusId } from "@/lib/types";

export function StatusBadge({ status }: { status: StatusId }) {
  return (
    <span className={`badge status-${status}`}>
      <i />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`badge priority-${priority}`}>{PRIORITY_LABELS[priority]}</span>;
}
