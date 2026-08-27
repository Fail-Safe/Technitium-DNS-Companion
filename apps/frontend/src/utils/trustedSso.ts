export function redirectToTrustedSsoLogout(
  logoutUrl: string,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): void {
  navigate(logoutUrl);
}
