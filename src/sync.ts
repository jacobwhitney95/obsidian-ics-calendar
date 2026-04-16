import { TFile, moment, requestUrl } from 'obsidian';
import type ICSCalendarPlugin from './main';
import { parseICS, ParsedEvent } from './parser';
import { getDailyNotePath, formatTime, isSameDay, dateKey } from './utils';
import { CalendarConfig } from './settings';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CalendarEvent extends ParsedEvent {
  calendarId: string;
  calendarName: string;
  calendarColor: string;
}

const UID_RE = /<!--\s*ics-uid:([^\s>]+)\s+cal:([^\s>]+)\s*-->/;

// ─── SyncManager ─────────────────────────────────────────────────────────────

export class SyncManager {
  /** In-memory cache: YYYY-MM-DD → events from all calendars */
  eventsByDate: Map<string, CalendarEvent[]> = new Map();
  private syncing = false;

  constructor(private plugin: ICSCalendarPlugin) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  async sync() {
    if (this.syncing) return; // prevent overlapping syncs
    this.syncing = true;
    try {
      await this._sync();
    } finally {
      this.syncing = false;
    }
  }

  private async _sync() {
    const today = new Date();
    const todayKey = dateKey(today);
    const allToday: CalendarEvent[] = [];

    for (const cal of this.plugin.settings.calendars) {
      if (!cal.enabled) continue;
      try {
        const events = await this.fetchCalendar(cal);
        const todayEvents = events.filter((e) => isSameDay(e.start, today));
        allToday.push(...todayEvents);
        await this.syncToDaily(todayEvents, cal, today);
      } catch (e) {
        console.error(`[ICS Calendar] Error syncing "${cal.name}":`, e);
      }
    }

    this.eventsByDate.set(todayKey, allToday);
    this.plugin.notifier.start();
  }

  async fetchCalendar(cal: CalendarConfig): Promise<CalendarEvent[]> {
    let text: string;

    if (cal.url.startsWith('http://') || cal.url.startsWith('https://')) {
      // Use Obsidian's requestUrl — bypasses CORS restrictions that block browser fetch
      const resp = await requestUrl({ url: cal.url, method: 'GET', cache: 'no-store' });
      if (resp.status !== 200) throw new Error(`HTTP ${resp.status} fetching ${cal.url}`);
      text = resp.text;
    } else {
      // Local vault .ics file
      const f = this.plugin.app.vault.getAbstractFileByPath(cal.url);
      if (!(f instanceof TFile)) throw new Error(`File not found: ${cal.url}`);
      text = await this.plugin.app.vault.read(f);
    }

    return parseICS(text).map((ev) => ({
      ...ev,
      calendarId: cal.id,
      calendarName: cal.name,
      calendarColor: cal.color,
    }));
  }

  // ── Daily note sync ────────────────────────────────────────────────────────

  private async syncToDaily(
    events: CalendarEvent[],
    cal: CalendarConfig,
    date: Date,
  ) {
    const path = getDailyNotePath(this.plugin.app, this.plugin.settings, moment(date));
    let file = this.plugin.app.vault.getAbstractFileByPath(path) as TFile | null;

    if (!file) {
      const dir = path.substring(0, path.lastIndexOf('/'));
      if (dir) {
        try {
          await this.plugin.app.vault.createFolder(dir);
        } catch { /* may already exist */ }
      }
      file = await this.plugin.app.vault.create(path, '');
    }

    let content = await this.plugin.app.vault.read(file);
    const lines = content.split('\n');

    // Map uid → line index for lines managed by this calendar
    const existingByUid = new Map<string, number>();
    lines.forEach((line, i) => {
      const m = line.match(UID_RE);
      if (m && m[2] === cal.id) existingByUid.set(m[1], i);
    });

    const incomingUids = new Set(events.map((e) => e.uid));

    // Lines to remove (existed before, not in current feed for this cal)
    const toRemove = new Set<number>();
    existingByUid.forEach((idx, uid) => {
      if (!incomingUids.has(uid)) toRemove.add(idx);
    });

    // Deduplicate incoming events by UID (keep last occurrence)
    const dedupedEvents = new Map<string, CalendarEvent>();
    for (const ev of events) dedupedEvents.set(ev.uid, ev);

    // Track UIDs added/updated this pass to prevent double-appends
    const processedThisPass = new Set<string>();

    // Update or append each incoming event
    for (const ev of dedupedEvents.values()) {
      if (processedThisPass.has(ev.uid)) continue;
      processedThisPass.add(ev.uid);

      const newLine = this.formatEventLine(ev, date);
      if (existingByUid.has(ev.uid)) {
        lines[existingByUid.get(ev.uid)!] = newLine;
      } else {
        lines.push(newLine);
      }
    }

    const finalLines = lines.filter((_, i) => !toRemove.has(i));
    await this.plugin.app.vault.modify(file, finalLines.join('\n'));
  }

  private formatEventLine(ev: CalendarEvent, date: Date): string {
    const ds = moment(date).format('YYYY-MM-DD');
    const timeBlock = ev.allDay
      ? `📅${ds}`
      : `📅${ds} ${formatTime(ev.start)} - 📅${ds} ${formatTime(ev.end)}`;
    return (
      `- [ ] ${timeBlock} ${ev.summary} ${ev.calendarName}` +
      ` <!-- ics-uid:${ev.uid} cal:${ev.calendarId} -->`
    );
  }
}
