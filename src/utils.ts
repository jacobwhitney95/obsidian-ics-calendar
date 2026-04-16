import { App, moment } from 'obsidian';
import { ICSCalendarSettings } from './settings';

/** Resolve today's (or any day's) daily note path, respecting the core Daily Notes plugin config if active. */
export function getDailyNotePath(
  app: App,
  settings: ICSCalendarSettings,
  date?: moment.Moment,
): string {
  const d = date ?? moment();

  // Try to read from core Daily Notes plugin first
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dn = (app as any).internalPlugins?.getPluginById('daily-notes');
    if (dn?.enabled) {
      const opts = dn.instance?.options;
      if (opts) {
        const fmt = opts.format || 'YYYY-MM-DD';
        const folder = (opts.folder || '').replace(/\/$/, '');
        const filename = d.format(fmt) + '.md';
        return folder ? `${folder}/${filename}` : filename;
      }
    }
  } catch {
    // fall through to plugin settings
  }

  const fmt = settings.dailyNoteFormat || 'YYYY-MM-DD';
  const folder = (settings.dailyNoteFolder || '').replace(/\/$/, '');
  const filename = d.format(fmt) + '.md';
  return folder ? `${folder}/${filename}` : filename;
}

export function formatTime(date: Date): string {
  return moment(date).format('HH:mm');
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function dateKey(date: Date): string {
  return moment(date).format('YYYY-MM-DD');
}
