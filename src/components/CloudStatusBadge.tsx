import {
  CLOUD_STATE_LABEL,
  type MemoSyncMetaRow,
} from "../types/memo";

type CloudStatusBadgeProps = {
  syncMeta: MemoSyncMetaRow;
};

export function CloudStatusBadge({ syncMeta }: CloudStatusBadgeProps) {
  return (
    <span
      className={`cloud-status-badge cloud-status-badge--${syncMeta.cloud_state}`}
      title={syncMeta.last_error ?? CLOUD_STATE_LABEL[syncMeta.cloud_state]}
    >
      {CLOUD_STATE_LABEL[syncMeta.cloud_state]}
    </span>
  );
}
