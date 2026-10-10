import type { ReactNode } from "react";
function Icon({ children }: { children: ReactNode }) { return <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{children}</svg>; }
export function MoreIcon(){return <Icon><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></Icon>}
export function NoteIcon(){return <Icon><path d="M5 4h14v15H9l-4 3z"/><path d="M8 9h8m-8 4h6"/></Icon>}
export function LinkIcon(){return <Icon><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-2 2m3 3a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l2-2"/></Icon>}
export function TagIcon(){return <Icon><path d="M4 4h8l8 8-8 8-8-8z"/><circle cx="8" cy="8" r="1"/></Icon>}
export function CopyIcon(){return <Icon><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></Icon>}
export function ChevronIcon(){return <Icon><path d="m9 6 6 6-6 6"/></Icon>}
export function CloudIcon(){return <Icon><path d="M7 18h11a5 5 0 0 0 .4-10A7 7 0 0 0 5 10a4 4 0 0 0 2 8"/></Icon>}
export function KeyboardIcon(){return <Icon><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01m4 0h.01m4 0h.01m4 0h.01M6 13h.01m4 0h.01m4 0h.01m4 0h.01M7 16h10"/></Icon>}
export function BackIcon(){return <Icon><path d="m14 5-7 7 7 7"/></Icon>}
