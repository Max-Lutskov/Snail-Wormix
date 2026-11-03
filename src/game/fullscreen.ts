/**
 * Fullscreen where the browser has it (Android, desktop, iPad); on iPhone Safari pages can't
 * go fullscreen, so the button explains the way there: add the game to the home screen
 * (index.html and the manifest make it open without browser bars).
 */

interface WebkitDocument {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}
interface WebkitElement {
  webkitRequestFullscreen?: () => void;
}

/** Already without browser bars: launched from the home screen. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function canFullscreen(): boolean {
  return (
    document.fullscreenEnabled || (document as WebkitDocument).webkitFullscreenEnabled === true
  );
}

export function isFullscreen(): boolean {
  const d = document as WebkitDocument;
  return (document.fullscreenElement ?? d.webkitFullscreenElement ?? null) !== null;
}

/** Goes fullscreen (landscape where the browser allows locking it). Call from a user gesture. */
export function enterFullscreen(): void {
  const el = document.documentElement;
  const lock = (): Promise<void> | undefined =>
    (screen.orientation as { lock?: (o: string) => Promise<void> }).lock?.('landscape');
  // Older iPad Safari only has the webkit-prefixed call.
  if ('requestFullscreen' in el) {
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(lock)
      .catch(() => undefined);
  } else {
    (el as WebkitElement).webkitRequestFullscreen?.();
  }
}

/** The fullscreen button: toggles it, or shows how to get there on iPhone. */
export function toggleFullscreen(): void {
  if (!canFullscreen()) {
    showHomeScreenHint();
    return;
  }
  if (!isFullscreen()) {
    enterFullscreen();
    return;
  }
  if ('exitFullscreen' in document) document.exitFullscreen().catch(() => undefined);
  else (document as WebkitDocument).webkitExitFullscreen?.();
}

/** A card over the game: Share → «На екран "Додому"». Any tap closes it. */
function showHomeScreenHint(): void {
  if (document.getElementById('fs-hint')) return;
  const box = document.createElement('div');
  box.id = 'fs-hint';
  box.style.cssText =
    'position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(20,28,22,.6);font-family:"Trebuchet MS",Arial,sans-serif;color:#fff;';
  box.innerHTML =
    '<div style="background:#1d2b3a;border:3px solid #ffe14d;border-radius:20px;padding:18px 22px;' +
    'max-width:min(420px,86vw);text-align:center;line-height:1.4">' +
    '<b style="font-size:19px;color:#ffe14d">На весь екран на iPhone</b><br><br>' +
    'Safari не пускає сайти у фулскрін. Зате гру можна додати на екран телефона:<br>' +
    'натисни <b>Поділитися</b> <span style="font-size:20px">⎋</span> → ' +
    '<b>«На екран “Додому”»</b>, і відкривай звідти — без рядка адреси й панелей.' +
    '<br><br><span style="opacity:.7;font-size:13px">Торкнись, щоб закрити</span></div>';
  box.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    box.remove();
  });
  document.body.append(box);
}
