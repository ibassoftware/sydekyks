import type { AutomationSchedule } from '../domain/schemas'

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const zonedParts = (date: Date, timezone: string): ZonedParts => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second')
  }
}

const localDateNumber = (parts: Pick<ZonedParts, 'year' | 'month' | 'day'>): number =>
  Date.UTC(parts.year, parts.month - 1, parts.day)

const addLocalDays = (
  parts: Pick<ZonedParts, 'year' | 'month' | 'day'>,
  days: number
): Pick<ZonedParts, 'year' | 'month' | 'day'> => {
  const date = new Date(localDateNumber(parts) + days * 86_400_000)
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

const weekday = (parts: Pick<ZonedParts, 'year' | 'month' | 'day'>): number =>
  new Date(localDateNumber(parts)).getUTCDay()

const zonedDate = (
  parts: Pick<ZonedParts, 'year' | 'month' | 'day'>,
  time: string,
  timezone: string
): Date => {
  const [hour, minute] = time.split(':').map(Number)
  const wanted = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, 0)
  let candidate = wanted
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(new Date(candidate), timezone)
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    )
    const adjustment = wanted - actualAsUtc
    if (adjustment === 0) break
    candidate += adjustment
  }
  return new Date(candidate)
}

export const nextScheduleRun = (schedule: AutomationSchedule, after = new Date()): Date => {
  const localAfter = zonedParts(after, schedule.timezone)
  if (schedule.kind === 'calendar') {
    const allowed = new Set(schedule.daysOfWeek)
    for (let offset = 0; offset < 14; offset += 1) {
      const date = addLocalDays(localAfter, offset)
      if (!allowed.has(weekday(date))) continue
      const candidate = zonedDate(date, schedule.time, schedule.timezone)
      if (candidate.getTime() > after.getTime()) return candidate
    }
    throw new Error('The calendar schedule has no future run')
  }

  const stepDays = schedule.every * (schedule.unit === 'weeks' ? 7 : 1)
  const anchor = new Date(schedule.anchorAt)
  const anchorLocal = zonedParts(anchor, schedule.timezone)
  const elapsedDays = Math.floor(
    (localDateNumber(localAfter) - localDateNumber(anchorLocal)) / 86_400_000
  )
  let steps = Math.max(0, Math.floor(elapsedDays / stepDays))
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = zonedDate(
      addLocalDays(anchorLocal, steps * stepDays),
      schedule.time,
      schedule.timezone
    )
    if (candidate.getTime() > after.getTime()) return candidate
    steps += 1
  }
  throw new Error('The interval schedule has no future run')
}

export const schedulePreview = (
  schedule: AutomationSchedule,
  count = 3,
  after = new Date()
): string[] => {
  const dates: string[] = []
  let cursor = after
  for (let index = 0; index < count; index += 1) {
    const next = nextScheduleRun(schedule, cursor)
    dates.push(next.toISOString())
    cursor = new Date(next.getTime() + 1_000)
  }
  return dates
}

export const scheduleLabel = (schedule: AutomationSchedule): string => {
  if (schedule.kind === 'interval') {
    const unit = schedule.unit === 'days' ? 'day' : 'week'
    return schedule.every === 1
      ? `Every ${unit} at ${schedule.time}`
      : `Every ${schedule.every} ${unit}s at ${schedule.time}`
  }
  const unique = [...new Set(schedule.daysOfWeek)].sort((left, right) => left - right)
  if (unique.length === 7) return `Every day at ${schedule.time}`
  if (unique.join(',') === '1,2,3,4,5') return `Weekdays at ${schedule.time}`
  if (unique.length === 1) return `Every ${weekdayNames[unique[0]]} at ${schedule.time}`
  return `${unique.map((day) => weekdayNames[day].slice(0, 3)).join(', ')} at ${schedule.time}`
}

export const intervalAnchor = (time: string, timezone: string, after = new Date()): string => {
  const local = zonedParts(after, timezone)
  const today = zonedDate(local, time, timezone)
  return (
    today.getTime() > after.getTime() ? today : zonedDate(addLocalDays(local, 1), time, timezone)
  ).toISOString()
}
