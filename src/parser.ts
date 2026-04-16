// Minimal ICS parser — handles real-world Outlook / Google calendar feeds.
// No external dependencies required.

// Windows timezone name → IANA timezone name mapping (same set as the ICS plugin)
const WIN_TZ: Record<string, string> = {
  'Dateline Standard Time': 'Etc/GMT+12', 'UTC-11': 'Etc/GMT+11',
  'Aleutian Standard Time': 'America/Adak', 'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Marquesas Standard Time': 'Pacific/Marquesas', 'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time': 'America/Los_Angeles', 'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time': 'America/Denver', 'Central Standard Time': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York', 'US Eastern Standard Time': 'America/Indianapolis',
  'SA Pacific Standard Time': 'America/Bogota', 'Atlantic Standard Time': 'America/Halifax',
  'Venezuela Standard Time': 'America/Caracas', 'SA Western Standard Time': 'America/La_Paz',
  'Newfoundland Standard Time': 'America/St_Johns', 'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Buenos_Aires', 'Greenland Standard Time': 'America/Godthab',
  'UTC': 'Etc/UTC', 'GMT Standard Time': 'Europe/London', 'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest', 'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw', 'GTB Standard Time': 'Europe/Bucharest',
  'Egypt Standard Time': 'Africa/Cairo', 'South Africa Standard Time': 'Africa/Johannesburg',
  'FLE Standard Time': 'Europe/Kiev', 'Israel Standard Time': 'Asia/Jerusalem',
  'Arabic Standard Time': 'Asia/Baghdad', 'Turkey Standard Time': 'Europe/Istanbul',
  'Arab Standard Time': 'Asia/Riyadh', 'Russian Standard Time': 'Europe/Moscow',
  'Iran Standard Time': 'Asia/Tehran', 'Arabian Standard Time': 'Asia/Dubai',
  'Pakistan Standard Time': 'Asia/Karachi', 'India Standard Time': 'Asia/Calcutta',
  'Central Asia Standard Time': 'Asia/Bishkek', 'Bangladesh Standard Time': 'Asia/Dhaka',
  'SE Asia Standard Time': 'Asia/Bangkok', 'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore', 'W. Australia Standard Time': 'Australia/Perth',
  'Tokyo Standard Time': 'Asia/Tokyo', 'Korea Standard Time': 'Asia/Seoul',
  'AUS Eastern Standard Time': 'Australia/Sydney', 'New Zealand Standard Time': 'Pacific/Auckland',
  'Fiji Standard Time': 'Pacific/Fiji',
};

function resolveTimezone(tzid: string): string {
  // Already a valid IANA name — return as-is
  if (tzid.includes('/')) return tzid;
  return WIN_TZ[tzid] ?? tzid;
}

export interface ParsedEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  allDay: boolean;
  status?: string;
}

/** Undo ICS line-folding (continuation lines begin with SPACE or TAB). */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n([ \t])/g, '$1')
    .replace(/\n([ \t])/g, '$1')
    .split(/\r?\n/);
}

/** Decode ICS escaped characters. */
function unescape(val: string): string {
  return val
    .replace(/\\n/g, '\n')
    .replace(/\\N/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/** Parse an ICS date/datetime string into a JS Date. */
function parseICSDate(
  value: string,
  params: string,
): { date: Date; allDay: boolean } {
  const allDay =
    /^\d{8}$/.test(value) || params.toUpperCase().includes('VALUE=DATE');

  if (allDay) {
    const y = +value.slice(0, 4);
    const m = +value.slice(4, 6) - 1;
    const d = +value.slice(6, 8);
    return { date: new Date(y, m, d, 0, 0, 0, 0), allDay: true };
  }

  // YYYYMMDDTHHMMSS[Z]
  const y = +value.slice(0, 4);
  const mo = +value.slice(4, 6) - 1;
  const d = +value.slice(6, 8);
  const h = +value.slice(9, 11);
  const mi = +value.slice(11, 13);
  const s = value.length >= 15 ? +value.slice(13, 15) : 0;
  const utc = value.endsWith('Z');

  // For TZID parameters, resolve Windows names to IANA, then convert.
  const tzidMatch = params.match(/TZID=([^;:]+)/i);
  const tzid = tzidMatch ? resolveTimezone(tzidMatch[1].trim()) : null;

  let date: Date;
  if (utc) {
    date = new Date(Date.UTC(y, mo, d, h, mi, s));
  } else if (tzid) {
    // Build ISO string then adjust from named timezone to UTC via Intl
    try {
      const isoLocal = `${y}-${pad(mo + 1)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`;
      // Find offset by comparing what Intl reports for that instant in the tzid
      const probe = new Date(Date.UTC(y, mo, d, h, mi, s));
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tzid,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(probe);

      const get = (t: string) =>
        parseInt(parts.find((p) => p.type === t)?.value ?? '0');
      const tzYear = get('year');
      const tzMonth = get('month') - 1;
      const tzDay = get('day');
      const tzHour = get('hour') % 24; // Intl may return 24 for midnight
      const tzMin = get('minute');
      const tzSec = get('second');

      const offsetMs =
        probe.getTime() -
        Date.UTC(tzYear, tzMonth, tzDay, tzHour, tzMin, tzSec);
      date = new Date(Date.UTC(y, mo, d, h, mi, s) + offsetMs);
    } catch {
      // TZID not recognised by Intl (e.g. "Eastern Standard Time") — treat as local
      date = new Date(y, mo, d, h, mi, s);
    }
  } else {
    date = new Date(y, mo, d, h, mi, s);
  }

  return { date, allDay: false };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Parse an ISO 8601 duration string relative to a start date. */
function addDuration(start: Date, duration: string): Date {
  const m = duration.match(
    /P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/,
  );
  if (!m) return new Date(start.getTime() + 3_600_000);
  const days =
    parseInt(m[1] ?? '0') * 365 +
    parseInt(m[2] ?? '0') * 30 +
    parseInt(m[3] ?? '0') * 7 +
    parseInt(m[4] ?? '0');
  const secs =
    parseInt(m[5] ?? '0') * 3600 +
    parseInt(m[6] ?? '0') * 60 +
    parseInt(m[7] ?? '0');
  return new Date(start.getTime() + days * 86_400_000 + secs * 1_000);
}

/** Parse a full ICS feed text and return all non-cancelled VEVENTs. */
export function parseICS(text: string): ParsedEvent[] {
  const lines = unfold(text);
  const events: ParsedEvent[] = [];

  let inEvent = false;
  let props: Record<string, string> = {};
  let params: Record<string, string> = {};

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      props = {};
      params = {};
      continue;
    }

    if (line === 'END:VEVENT') {
      inEvent = false;

      const uid = props['UID'];
      const status = props['STATUS'];
      if (status?.toUpperCase() === 'CANCELLED') continue;
      if (!uid || !props['DTSTART']) continue;

      const summary = props['SUMMARY']
        ? unescape(props['SUMMARY'])
        : '(No Title)';

      const { date: start, allDay } = parseICSDate(
        props['DTSTART'],
        params['DTSTART'] ?? '',
      );

      let end: Date;
      if (props['DTEND']) {
        end = parseICSDate(props['DTEND'], params['DTEND'] ?? '').date;
      } else if (props['DURATION']) {
        end = addDuration(start, props['DURATION']);
      } else {
        end = new Date(start.getTime() + (allDay ? 86_400_000 : 3_600_000));
      }

      events.push({
        uid,
        summary,
        description: props['DESCRIPTION']
          ? unescape(props['DESCRIPTION'])
          : undefined,
        location: props['LOCATION']
          ? unescape(props['LOCATION'])
          : undefined,
        start,
        end,
        allDay,
        status,
      });

      props = {};
      params = {};
      continue;
    }

    if (!inEvent) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;

    const fullProp = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);
    const semiIdx = fullProp.indexOf(';');
    const propName =
      semiIdx >= 0
        ? fullProp.slice(0, semiIdx).toUpperCase()
        : fullProp.toUpperCase();
    const paramStr = semiIdx >= 0 ? fullProp.slice(semiIdx + 1) : '';

    props[propName] = value;
    if (paramStr) params[propName] = paramStr;
  }

  return events;
}
