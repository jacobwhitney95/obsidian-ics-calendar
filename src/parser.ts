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

interface ParsedDateValue {
  date: Date;
  allDay: boolean;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  utc: boolean;
  tzid: string | null;
}

interface RawEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  startInfo: ParsedDateValue;
  start: Date;
  end: Date;
  durationMs: number;
  allDay: boolean;
  status?: string;
  rrule?: string;
  recurrenceIdInfo?: ParsedDateValue;
  exdateInfos: ParsedDateValue[];
}

/** Undo ICS line-folding (continuation lines begin with SPACE or TAB). */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n[ \t]/g, '')   // RFC 5545: strip CRLF + leading whitespace
    .replace(/\n[ \t]/g, '')      // LF-only variant
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
): ParsedDateValue {
  const allDay =
    /^\d{8}$/.test(value) || params.toUpperCase().includes('VALUE=DATE');

  const y = +value.slice(0, 4);
  const mo = +value.slice(4, 6) - 1;
  const d = +value.slice(6, 8);

  let h = 0;
  let mi = 0;
  let s = 0;
  let utc = false;
  let tzid: string | null = null;

  if (allDay) {
    const date = dateFromParts({
      allDay: true,
      year: y,
      month: mo,
      day: d,
      hour: 0,
      minute: 0,
      second: 0,
      utc: false,
      tzid: null,
    });
    return {
      date,
      allDay: true,
      year: y,
      month: mo,
      day: d,
      hour: 0,
      minute: 0,
      second: 0,
      utc: false,
      tzid: null,
    };
  }

  // YYYYMMDDTHHMMSS[Z]
  h = +value.slice(9, 11);
  mi = +value.slice(11, 13);
  s = value.length >= 15 ? +value.slice(13, 15) : 0;
  utc = value.endsWith('Z');

  if (!utc) {
    const tzidMatch = params.match(/TZID=([^;:]+)/i);
    tzid = tzidMatch ? resolveTimezone(tzidMatch[1].trim()) : null;
  }

  const date = dateFromParts({
    allDay: false,
    year: y,
    month: mo,
    day: d,
    hour: h,
    minute: mi,
    second: s,
    utc,
    tzid,
  });

  return {
    date,
    allDay: false,
    year: y,
    month: mo,
    day: d,
    hour: h,
    minute: mi,
    second: s,
    utc,
    tzid,
  };
}

function dateFromParts(parts: Omit<ParsedDateValue, 'date'>): Date {
  if (parts.allDay) {
    return new Date(parts.year, parts.month, parts.day, 0, 0, 0, 0);
  }

  if (parts.utc) {
    return new Date(
      Date.UTC(
        parts.year,
        parts.month,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
      ),
    );
  }

  if (parts.tzid) {
    return localTimeInZoneToUTC(
      parts.year,
      parts.month,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.tzid,
    );
  }

  return new Date(
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

/**
 * Convert a wall-clock time in a named IANA/Windows timezone to a UTC Date.
 * Uses an iterative approach: start with a UTC guess, check what wall-clock
 * time Intl reports in that timezone, then correct for the difference.
 */
function localTimeInZoneToUTC(
  y: number, mo: number, d: number,
  h: number, mi: number, s: number,
  tzid: string,
): Date {
  try {
    // First guess: treat the wall-clock time as UTC
    let guess = Date.UTC(y, mo, d, h, mi, s);

    // Two iterations are enough to handle DST boundary edge cases
    for (let i = 0; i < 2; i++) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tzid,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      }).formatToParts(new Date(guess));

      const get = (t: string) =>
        parseInt(parts.find((p) => p.type === t)?.value ?? '0');

      const tzYear  = get('year');
      const tzMonth = get('month') - 1;
      const tzDay   = get('day');
      const tzHour  = get('hour') % 24; // guard against Intl returning 24
      const tzMin   = get('minute');
      const tzSec   = get('second');

      // Difference between what we want and what the guess gives us in that zone
      const diff = Date.UTC(y, mo, d, h, mi, s) - Date.UTC(tzYear, tzMonth, tzDay, tzHour, tzMin, tzSec);
      guess += diff;
    }

    return new Date(guess);
  } catch {
    // TZID not recognised by Intl — fall back to treating as local time
    return new Date(y, mo, d, h, mi, s);
  }
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

/** Parse a full ICS feed text and return all non-cancelled VEVENTs.
 *  Recurring events (RRULE) are expanded for a ±6-month window around today. */
export function parseICS(text: string): ParsedEvent[] {
  const lines = unfold(text);
  const rawEvents: RawEvent[] = [];

  let inEvent = false;
  let props: Record<string, string[]> = {};
  let params: Record<string, string[]> = {};

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      props = {};
      params = {};
      continue;
    }

    if (line === 'END:VEVENT') {
      inEvent = false;

      const uid = firstProp(props, 'UID');
      const status = firstProp(props, 'STATUS');
      const dtStartValue = firstProp(props, 'DTSTART');
      if (!uid || !dtStartValue) continue;

      const summary = firstProp(props, 'SUMMARY')
        ? unescape(firstProp(props, 'SUMMARY')!)
        : '(No Title)';

      const startInfo = parseICSDate(
        dtStartValue,
        firstParam(params, 'DTSTART'),
      );
      const start = startInfo.date;
      const allDay = startInfo.allDay;

      let end: Date;
      const dtEndValue = firstProp(props, 'DTEND');
      const durationValue = firstProp(props, 'DURATION');
      if (dtEndValue) {
        end = parseICSDate(dtEndValue, firstParam(params, 'DTEND')).date;
      } else if (durationValue) {
        end = addDuration(start, durationValue);
      } else {
        end = new Date(start.getTime() + (allDay ? 86_400_000 : 3_600_000));
      }

      const recurrenceIdValue = firstProp(props, 'RECURRENCE-ID');
      const recurrenceIdInfo = recurrenceIdValue
        ? parseICSDate(recurrenceIdValue, firstParam(params, 'RECURRENCE-ID'))
        : undefined;

      rawEvents.push({
        uid,
        summary,
        description: firstProp(props, 'DESCRIPTION')
          ? unescape(firstProp(props, 'DESCRIPTION')!)
          : undefined,
        location: firstProp(props, 'LOCATION')
          ? unescape(firstProp(props, 'LOCATION')!)
          : undefined,
        startInfo,
        start,
        end,
        durationMs: end.getTime() - start.getTime(),
        allDay,
        status,
        rrule: firstProp(props, 'RRULE'),
        recurrenceIdInfo,
        exdateInfos: parseDateList(props['EXDATE'] ?? [], params['EXDATE'] ?? []),
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

    (props[propName] ??= []).push(value);
    (params[propName] ??= []).push(paramStr);
  }

  return finalizeEvents(rawEvents);
}

// ─── RRULE expansion ──────────────────────────────────────────────────────────
// Handles moved/cancelled recurring instances via RECURRENCE-ID and EXDATE.
// Expands FREQ=DAILY/WEEKLY/MONTHLY/YEARLY while preserving the source
// wall-clock time so recurring meetings stay aligned across DST changes.

const DAY_NAMES: Record<string, number> = { SU:0, MO:1, TU:2, WE:3, TH:4, FR:5, SA:6 };

function firstProp(props: Record<string, string[]>, name: string): string | undefined {
  return props[name]?.[0];
}

function firstParam(params: Record<string, string[]>, name: string): string {
  return params[name]?.[0] ?? '';
}

function parseDateList(values: string[], paramList: string[]): ParsedDateValue[] {
  const parsed: ParsedDateValue[] = [];

  values.forEach((value, index) => {
    const params = paramList[index] ?? '';
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => parsed.push(parseICSDate(part, params)));
  });

  return parsed;
}

function formatOccurrenceKey(info: ParsedDateValue): string {
  const datePart = `${info.year}${pad(info.month + 1)}${pad(info.day)}`;
  if (info.allDay) return datePart;

  const timePart = `${pad(info.hour)}${pad(info.minute)}${pad(info.second)}`;
  return `${datePart}T${timePart}${info.utc ? 'Z' : ''}`;
}

function makeOccurrenceUid(uid: string, key: string): string {
  return `${uid}::${key}`;
}

function addToSet(map: Map<string, Set<string>>, key: string, value: string) {
  if (!map.has(key)) map.set(key, new Set<string>());
  map.get(key)!.add(value);
}

function addToNestedMap(
  map: Map<string, Map<string, RawEvent>>,
  uid: string,
  occurrenceKey: string,
  event: RawEvent,
) {
  if (!map.has(uid)) map.set(uid, new Map<string, RawEvent>());
  map.get(uid)!.set(occurrenceKey, event);
}

function toParsedEvent(
  raw: RawEvent,
  uid = raw.uid,
  occurrenceInfo?: ParsedDateValue,
): ParsedEvent {
  const start = occurrenceInfo ? occurrenceInfo.date : raw.start;
  const end = occurrenceInfo
    ? new Date(start.getTime() + raw.durationMs)
    : raw.end;

  return {
    uid,
    summary: raw.summary,
    description: raw.description,
    location: raw.location,
    start,
    end,
    allDay: raw.allDay,
    status: raw.status,
  };
}

function buildOccurrenceInfo(base: ParsedDateValue, localDate: Date): ParsedDateValue {
  const info: Omit<ParsedDateValue, 'date'> = {
    allDay: base.allDay,
    year: localDate.getFullYear(),
    month: localDate.getMonth(),
    day: localDate.getDate(),
    hour: base.hour,
    minute: base.minute,
    second: base.second,
    utc: base.utc,
    tzid: base.tzid,
  };

  return {
    ...info,
    date: dateFromParts(info),
  };
}

function startOfWeek(date: Date, weekStartDay: number): Date {
  const result = new Date(date);
  const diff = (result.getDay() - weekStartDay + 7) % 7;
  result.setDate(result.getDate() - diff);
  return result;
}

function sortWeekdays(days: number[], weekStartDay: number): number[] {
  return [...new Set(days)].sort(
    (a, b) => ((a - weekStartDay + 7) % 7) - ((b - weekStartDay + 7) % 7),
  );
}

function finalizeEvents(rawEvents: RawEvent[]): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const masters: RawEvent[] = [];
  const suppressedByUid = new Map<string, Set<string>>();
  const overridesByUid = new Map<string, Map<string, RawEvent>>();

  for (const raw of rawEvents) {
    if (raw.recurrenceIdInfo) {
      const occurrenceKey = formatOccurrenceKey(raw.recurrenceIdInfo);
      addToSet(suppressedByUid, raw.uid, occurrenceKey);

      if (raw.status?.toUpperCase() !== 'CANCELLED') {
        addToNestedMap(overridesByUid, raw.uid, occurrenceKey, raw);
      }
      continue;
    }

    if (raw.rrule) {
      masters.push(raw);
      continue;
    }

    if (raw.status?.toUpperCase() !== 'CANCELLED') {
      events.push(toParsedEvent(raw));
    }
  }

  for (const master of masters) {
    if (master.status?.toUpperCase() === 'CANCELLED') continue;

    const suppressed = new Set<string>(
      master.exdateInfos.map((info) => formatOccurrenceKey(info)),
    );
    const overrideKeys = suppressedByUid.get(master.uid);
    if (overrideKeys) {
      overrideKeys.forEach((key) => suppressed.add(key));
    }

    events.push(...expandRRule(master, suppressed));
  }

  overridesByUid.forEach((occurrences, uid) => {
    occurrences.forEach((raw, occurrenceKey) => {
      events.push(toParsedEvent(raw, makeOccurrenceUid(uid, occurrenceKey)));
    });
  });

  return events.sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.summary.localeCompare(b.summary),
  );
}

function expandRRule(base: RawEvent, suppressed: Set<string>): ParsedEvent[] {
  const now = Date.now();
  const windowStart = now - 6 * 30 * 86_400_000;
  const windowEnd = now + 6 * 30 * 86_400_000;

  const parts: Record<string, string> = {};
  for (const seg of (base.rrule ?? '').split(';')) {
    const eq = seg.indexOf('=');
    if (eq >= 0) parts[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1);
  }

  const freq = (parts['FREQ'] ?? '').toUpperCase();
  const interval = parseInt(parts['INTERVAL'] ?? '1') || 1;
  const count = parts['COUNT'] ? parseInt(parts['COUNT']) : null;
  const byDay = parts['BYDAY']
    ? parts['BYDAY']
        .split(',')
        .map((day) => DAY_NAMES[day.replace(/[+-\d]/g, '').toUpperCase()])
        .filter((day): day is number => day !== undefined)
    : null;
  const weekStartDay = DAY_NAMES[(parts['WKST'] ?? 'MO').toUpperCase()] ?? 1;

  let until: number | null = null;
  if (parts['UNTIL']) {
    try {
      const u = parts['UNTIL'];
      // UNTIL can be DATE (YYYYMMDD) or DATETIME (YYYYMMDDTHHmmssZ)
      const uy = +u.slice(0, 4);
      const um = +u.slice(4, 6) - 1;
      const ud = +u.slice(6, 8);
      until = u.length > 8
        ? new Date(
            Date.UTC(
              uy,
              um,
              ud,
              +u.slice(9, 11),
              +u.slice(11, 13),
              +u.slice(13, 15),
            ),
          ).getTime()
        : new Date(uy, um, ud, 23, 59, 59).getTime();
    } catch { /* ignore bad UNTIL */ }
  }

  const results: ParsedEvent[] = [];
  const baseLocal = new Date(
    base.startInfo.year,
    base.startInfo.month,
    base.startInfo.day,
    base.startInfo.hour,
    base.startInfo.minute,
    base.startInfo.second,
  );

  let emittedCount = 0;
  const MAX = 2000;

  const emitOccurrence = (occurrenceInfo: ParsedDateValue): boolean => {
    const time = occurrenceInfo.date.getTime();

    if (time < base.start.getTime()) return false;
    if (until !== null && time > until) return true;
    if (count !== null && emittedCount >= count) return true;
    if (time > windowEnd) return true;

    emittedCount += 1;
    const occurrenceKey = formatOccurrenceKey(occurrenceInfo);
    if (!suppressed.has(occurrenceKey) && time >= windowStart) {
      results.push(
        toParsedEvent(base, makeOccurrenceUid(base.uid, occurrenceKey), occurrenceInfo),
      );
    }

    return count !== null && emittedCount >= count;
  };

  switch (freq) {
    case 'DAILY': {
      for (let step = 0; step < MAX; step++) {
        const candidate = new Date(baseLocal);
        candidate.setDate(candidate.getDate() + step * interval);
        if (emitOccurrence(buildOccurrenceInfo(base.startInfo, candidate))) break;
      }
      break;
    }

    case 'WEEKLY': {
      const weekStart = startOfWeek(baseLocal, weekStartDay);
      const weekdays = sortWeekdays(byDay ?? [baseLocal.getDay()], weekStartDay);

      for (let week = 0; week < MAX; week += interval) {
        const thisWeekStart = new Date(weekStart);
        thisWeekStart.setDate(thisWeekStart.getDate() + week * 7);

        let shouldStop = false;
        for (const weekday of weekdays) {
          const candidate = new Date(thisWeekStart);
          const offset = (weekday - weekStartDay + 7) % 7;
          candidate.setDate(candidate.getDate() + offset);

          if (emitOccurrence(buildOccurrenceInfo(base.startInfo, candidate))) {
            shouldStop = true;
            break;
          }
        }

        if (shouldStop) break;
      }
      break;
    }

    case 'MONTHLY': {
      for (let step = 0; step < MAX; step++) {
        const candidate = new Date(baseLocal);
        candidate.setMonth(candidate.getMonth() + step * interval);

        const occurrenceInfo = buildOccurrenceInfo(base.startInfo, candidate);
        if (byDay && byDay.length > 0 && !byDay.includes(candidate.getDay())) {
          continue;
        }
        if (emitOccurrence(occurrenceInfo)) break;
      }
      break;
    }

    case 'YEARLY': {
      for (let step = 0; step < MAX; step++) {
        const candidate = new Date(baseLocal);
        candidate.setFullYear(candidate.getFullYear() + step * interval);

        const occurrenceInfo = buildOccurrenceInfo(base.startInfo, candidate);
        if (byDay && byDay.length > 0 && !byDay.includes(candidate.getDay())) {
          continue;
        }
        if (emitOccurrence(occurrenceInfo)) break;
      }
      break;
    }

    default:
      results.push(toParsedEvent(base));
  }

  return results;
}
