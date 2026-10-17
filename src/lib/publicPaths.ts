/**
 * Pages that render without signing in (outside AuthGate, see src/routes/__root.tsx): the tenant
 * maintenance-request form, plus the privacy policy and terms Google's OAuth verification needs
 * at public URLs.
 */
const PUBLIC_PATHS = ["/maintenance", "/privacy", "/terms"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
