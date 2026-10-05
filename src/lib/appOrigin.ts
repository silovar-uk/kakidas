export const CANONICAL_APP_ORIGIN = "https://kakidas-3gqw.vercel.app";

const LEGACY_APP_HOSTS = new Set([
  "kakidas.vercel.app",
  "kakidas-silovars-projects.vercel.app",
  "kakidas-git-main-silovars-projects.vercel.app",
]);

export function isLegacyAppHost(hostname: string): boolean {
  return LEGACY_APP_HOSTS.has(hostname);
}
