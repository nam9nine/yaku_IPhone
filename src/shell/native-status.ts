/** Installed iOS web apps already have the device's own status bar. */
export function configureNativeStatusBar() {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone =
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  document.documentElement.toggleAttribute('data-native-status-bar', ios && standalone);
}
