declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe: Record<string, unknown>;
        ready: () => void;
        expand: () => void;
        openLink: (url: string) => void;
        close: () => void;
      };
    };
  }
}

export const tg = window.Telegram?.WebApp;

// Expand to full height immediately — Telegram opens Mini Apps at ~80% by default
if (tg) {
  tg.ready();
  tg.expand();
}

export function isMiniApp(): boolean {
  return !!(tg?.initData && tg.initData.length > 0);
}

export function getInitData(): string {
  return tg?.initData ?? "";
}
