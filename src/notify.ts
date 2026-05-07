import { Notice } from 'obsidian';
import type ICSCalendarPlugin from './main';
import type { ParsedEvent } from './parser';
import { formatTime, isSameDay } from './utils';

// ─── Native notification via Web Notification API ─────────────────────────────
//
// Electron's renderer process (where Obsidian plugins run) has full access to
// window.Notification — the standard browser Notification API. This is simpler
// and more reliable than going through @electron/remote, which requires the main
// process to explicitly enable it per BrowserWindow (Obsidian doesn't do this
// for plugins).

/** Fire a native OS Action-Center notification.
 *  Returns true on success; false if notifications are unavailable/denied. */
export function fireNativeNotification(
  title: string,
  body: string,
  onClick?: () => void,
): boolean {
  try {
    if (!('Notification' in window)) return false;

    if (Notification.permission === 'denied') return false;

    // If not yet granted, request permission (async — won't fire this time)
    if (Notification.permission === 'default') {
      Notification.requestPermission();
      return false;
    }

    const n = new Notification(title, { body, silent: false });
    n.onclick = onClick ?? (() => { window.focus(); });
    return true;
  } catch (e) {
    console.warn('[ICS Calendar] Notification failed:', e);
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
