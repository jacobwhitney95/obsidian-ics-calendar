import { ItemView, WorkspaceLeaf, TFile, moment } from 'obsidian';
import type ICSCalendarPlugin from './main';
import type { CalendarEvent } from './sync';
import { getDailyNotePath, formatTime, dateKey } from './utils';

export const CALENDAR_VIEW_TYPE = 'ics-calendar-view';

export class CalendarView extends ItemView {
  private plugin: ICSCalendarPlugin;
  private currentMonth: moment.Moment;

  constructor(leaf: WorkspaceLeaf, plugin: ICSCalendarPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentMonth = moment().startOf('month');
  }

  getViewType() { return CALENDAR_VIEW_TYPE; }
  getDisplayText() { return 'ICS Calendar'; }
  getIcon() { return 'calendar'; }

  async onOpen() { this.render(); }
  async onClose() { /* nothing */ }

  refresh() { this.render(); }

  // ── Render ─────────────────────────────────────────────────────────────────

  private render() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass('ics-cal-root');

    this.renderMonthHeader(root);
    this.renderDayLabels(root);
    this.renderDaysGrid(root);
    this.renderTimeline(root);
  }

  private renderMonthHeader(root: HTMLElement) {
    const hdr = root.createDiv('ics-month-header');

    const prev = hdr.createEl('button', { cls: 'ics-nav-btn', text: '‹' });
    prev.addEventListener('click', () => {
      this.currentMonth.subtract(1, 'month');
      this.render();
    });

    hdr.createEl('span', {
      cls: 'ics-month-title',
      text: this.currentMonth.format('MMMM YYYY'),
    });

    const next = hdr.createEl('button', { cls: 'ics-nav-btn', text: '›' });
    next.addEventListener('click', () => {
      this.currentMonth.add(1, 'month');
      this.render();
    });
  }

  private renderDayLabels(root: HTMLElement) {
    const row = root.createDiv('ics-day-labels');
    ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach((d) =>
      row.createEl('span', { cls: 'ics-day-label', text: d }),
    );
  }

  private renderDaysGrid(root: HTMLElement) {
    const grid = root.createDiv('ics-days-grid');
    const today = moment();
    const start = this.currentMonth.clone().startOf('month');
    const end = this.currentMonth.clone().endOf('month');

    // Leading empty cells
    for (let i = 0; i < start.day(); i++) {
      grid.createDiv('ics-day ics-day-empty');
    }

    const d = start.clone();
    while (d.isSameOrBefore(end, 'day')) {
      const key = d.format('YYYY-MM-DD');
      const isToday = d.isSame(today, 'day');
      const hasEvents = !!(this.plugin.syncManager?.eventsByDate.get(key)?.length);

      const cell = grid.createDiv(`ics-day${isToday ? ' ics-today' : ''}`);
      cell.createEl('span', { cls: 'ics-day-num', text: String(d.date()) });
      if (hasEvents) cell.createDiv('ics-dot');

      const captured = d.clone();
      cell.addEventListener('click', () => this.openDailyNote(captured));

      d.add(1, 'day');
    }
  }

  private renderTimeline(root: HTMLElement) {
    const section = root.createDiv('ics-timeline');
    section.createEl('p', { cls: 'ics-timeline-heading', text: "Today's Events" });

    const todayKey = dateKey(new Date());
    const events: CalendarEvent[] =
      (this.plugin.syncManager?.eventsByDate.get(todayKey) ?? [])
        .slice()
        .sort((a, b) => a.start.getTime() - b.start.getTime());

    if (events.length === 0) {
      section.createEl('p', { cls: 'ics-no-events', text: 'No events today.' });
      return;
    }

    const now = Date.now();
    for (const ev of events) {
      const isPast = ev.end.getTime() < now;
      const row = section.createDiv(`ics-event-row${isPast ? ' ics-past' : ''}`);

      const bar = row.createDiv('ics-event-bar');
      bar.style.backgroundColor = ev.calendarColor || 'var(--interactive-accent)';

      const info = row.createDiv('ics-event-info');
      info.createEl('span', {
        cls: 'ics-event-time',
        text: ev.allDay
          ? 'All day'
          : `${formatTime(ev.start)} – ${formatTime(ev.end)}`,
      });
      info.createEl('span', { cls: 'ics-event-title', text: ev.summary });
      info.createEl('span', { cls: 'ics-event-cal', text: ev.calendarName });

      row.addEventListener('click', () => this.scrollToEvent(ev));
    }
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  private async openDailyNote(date: moment.Moment) {
    const path = getDailyNotePath(this.plugin.app, this.plugin.settings, date);
    let file = this.plugin.app.vault.getAbstractFileByPath(path) as TFile | null;

    if (!file) {
      const dir = path.substring(0, path.lastIndexOf('/'));
      if (dir) {
        try { await this.plugin.app.vault.createFolder(dir); } catch { /* ok */ }
      }
      file = await this.plugin.app.vault.create(path, '');
    }

    if (file) {
      await this.plugin.app.workspace.getLeaf(false).openFile(file);
    }
  }

  private async scrollToEvent(ev: CalendarEvent) {
    const path = getDailyNotePath(this.plugin.app, this.plugin.settings, moment());
    const file = this.plugin.app.vault.getAbstractFileByPath(path) as TFile | null;
    if (!file) return;

    const leaf = this.plugin.app.workspace.getLeaf(false);
    await leaf.openFile(file);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = (leaf.view as any).editor;
    if (!editor) return;

    const lines: string[] = editor.getValue().split('\n');
    const idx = lines.findIndex((l: string) => l.includes(`ics-uid:${ev.uid}`));
    if (idx >= 0) {
      editor.setCursor({ line: idx, ch: 0 });
      editor.scrollIntoView(
        { from: { line: idx, ch: 0 }, to: { line: idx, ch: 0 } },
        true,
      );
    }
  }
}
