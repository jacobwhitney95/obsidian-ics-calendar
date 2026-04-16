import { Notice } from 'obsidian';
import type ICSCalendarPlugin from './main';
import type { ParsedEvent } from './parser';
import { formatTime, isSameDay } from './utils';

// ─── Electron notification helper ─────────────────────────────────────────────

type ElectronNotificationClass = {
  isSupported(): boolean;
  new (opts: { title: string; body: string; silent?: boolean }): {
    on(event: string, cb: () => void): void;
    show(): void;
  };
};

function getElectronNotification(): ElectronNotificationClass | null {
  try {
    // Modern Obsidian (Electron 14+) uses @electron/remote
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const remote = require('@electron/remote') as { Notification?: ElectronNotificationClass };
    if (remote?.Notification) return remote.Notification;
  } catch { /* not available */ }

  try {
    // Older Electron — electron.remote
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as { remote?: { Notification?: ElectronNotificationClass } };
    if (electron?.remote?.Notification) return electron.remote.Notification;
  } catch { /* not available */ }

  return null;
}

/** Fire a native Windows (or macOS) Action-Center notification via Electron.
 *  Returns true on success; false if Electron is unavailable (mobile/web). */
export function fireNativeNotification(
  title: string,
  body: string,
  onClick?: () => void,
): boolean {
  const ElNotif = getElectronNotification();
  if (!ElNotif) return false;

  try {
    if (!ElNotif.isSupported()) return false;

    const n = new ElNotif({ title, body, silent: false });

    if (onClick) {
      n.on('click', onClick);
    } else {
      // Default: bring Obsidian window to front
      n.on('click', () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const remote = require('@electron/remote') as { getCurrentWindow?(): { show(): void; focus(): void } };
          remote.getCurrentWindow?.()?.show?.();
          remote.getCurrentWindow?.()?.focus?.();
        } catch { /* ignore */ }
      });
    }

    n.show();
    return true;
  } catch (e) {
    console.warn('[ICS Calendar] Electron notification failed:', e);
    return false;
  }
}

// ─── Notification Scheduler ───────────────────────────────────────────────────

export interface ScheduledNotif {
  key: string; // uid + dateStr
  fireAt: number; // unix ms
  title: string;
  body: string;
}

export class NotificationScheduler {
  /** Keys of notifications already fired this session */
  private fired = new Set<string>();
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(private plugin: ICSCalendarPlugin) {}

  /** Start the per-minute check loop. */
  start() {
    this.stop();
    // Check immediately, then every 60 s
    this.tick();
    this.intervalId = setInterval(() => this.tick(), 60_000);
  }

  stop() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private tick() {
    const now = Date.now();
    const today = new Date();
    const lead = this.plugin.settings.notificationLeadMinutes * 60_000;
    const syncMgr = this.plugin.syncManager;
    if (!syncMgr) return;

    for (const [, events] of syncMgr.eventsByDate) {
      for (const ev of events) {
        if (!isSameDay(ev.start, today)) continue;

        const key = `${ev.uid}:${today.toDateString()}`;
        if (this.fired.has(key)) continue;

        const fireAt = ev.start.getTime() - lead;
        if (now >= fireAt && now < ev.start.getTime() + 60_000) {
          this.fired.add(key);
          this.fireEvent(ev);
        }
      }
    }
  }

  private fireEvent(ev: ParsedEvent & { calendarName?: string }) {
    const title = ev.summary;
    const body = ev.allDay
      ? `All day · ${ev.calendarName ?? ''}`
      : `${formatTime(ev.start)} – ${formatTime(ev.end)} · ${ev.calendarName ?? ''}`;

    const fired = fireNativeNotification(title, body);

    // Show Obsidian toast if: (a) native failed, or (b) showObsidianToast is on
    if (!fired || this.plugin.settings.showObsidianToast) {
      new Notice(`📅 ${title}\n${body}`, 10_000);
    }
  }
}
