export type DisplayNumberRow = {
  id: string;
  parent_id: string | null;
  outline_number: string;
  child_count: number;
  has_children: boolean;
};
export function numberVisibleOutline<T extends DisplayNumberRow>(rows: T[]): T[];
