'use strict';

const { MS_PER_DAY } = require('./lookup');
const { ERRORS, isError } = require('./references');
const { flatten, isBlank, toNumber } = require('./values');

function serialFromDate(date, withTime = false) {
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.floor(utc / MS_PER_DAY) + 25569;
  if (!withTime) return days;
  const seconds = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
  return days + seconds / 86400;
}

function dateSerialFromMs(milliseconds) {
  return Math.floor(milliseconds / MS_PER_DAY) + 25569;
}

function dateSerial(year, month, day) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return ERRORS['#VALUE!'];
  if (year < 0 || year > 9999) return ERRORS['#NUM!'];
  const adjustedYear = year < 1900 ? year + 1900 : year;
  const date = new Date(Date.UTC(adjustedYear, month - 1, day));
  if (Number.isNaN(date.getTime())) return ERRORS['#NUM!'];
  return serialFromDate(new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function timeSerial(hours, minutes, seconds) {
  const total = hours * 3600 + minutes * 60 + seconds;
  if (!Number.isFinite(total)) return ERRORS['#VALUE!'];
  if (total < 0) return ERRORS['#NUM!'];
  return (total % 86400) / 86400;
}

function serialToParts(serial) {
  if (isError(serial)) return serial;
  const value = toNumber(serial);
  if (isError(value)) return value;
  if (value < 0) return ERRORS['#NUM!'];
  const whole = Math.floor(value);
  // Time is derived from the fractional day arithmetically. Round-tripping it
  // through Date drifts by minutes, because the 1900 epoch is not an exact
  // millisecond boundary.
  let secondsOfDay = Math.round((value - whole) * 86400);
  if (secondsOfDay >= 86400) secondsOfDay = 86399;
  const date = serialToUtcDate(whole);
  if (!date) return ERRORS['#NUM!'];
  return {
    date,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: Math.floor(secondsOfDay / 3600),
    minute: Math.floor((secondsOfDay % 3600) / 60),
    second: secondsOfDay % 60
  };
}

function serialToUtcDate(whole) {
  const daySerial = whole > 60 ? whole - 1 : whole;
  const date = new Date((daySerial - 25568) * MS_PER_DAY);
  return Number.isNaN(date.getTime()) ? null : date;
}

function datePart(value, part) {
  const parts = serialToParts(value);
  if (isError(parts)) return parts;
  return parts[part];
}

function addMonths(serial, months, endOfMonth) {
  const parts = serialToParts(serial);
  const count = Math.trunc(toNumber(months));
  if (isError(parts)) return parts;
  if (isError(count)) return count;
  const sourceDay = parts.day;
  const first = new Date(Date.UTC(parts.year, parts.month - 1 + count, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const day = endOfMonth ? lastDay : Math.min(sourceDay, lastDay);
  return dateSerial(first.getUTCFullYear(), first.getUTCMonth() + 1, day);
}

function holidaySet(value) {
  const result = new Set();
  for (const holiday of flatten([value])) {
    if (isBlank(holiday)) continue;
    const numeric = toNumber(holiday);
    if (!isError(numeric)) result.add(Math.trunc(numeric));
  }
  return result;
}

function isWorkdaySerial(serial, holidays) {
  const date = serialToUtcDate(Math.trunc(serial));
  if (!date) return false;
  const day = date.getUTCDay();
  return day !== 0 && day !== 6 && !holidays.has(Math.trunc(serial));
}

function workday(startValue, daysValue, holidayValue) {
  const start = Math.trunc(toNumber(startValue));
  const days = Math.trunc(toNumber(daysValue));
  if (isError(start)) return start;
  if (isError(days)) return days;
  const holidays = holidaySet(holidayValue);
  const direction = days < 0 ? -1 : 1;
  let remaining = Math.abs(days);
  let cursor = start;
  while (remaining > 0) {
    cursor += direction;
    if (isWorkdaySerial(cursor, holidays)) remaining -= 1;
  }
  return cursor;
}

function networkdays(startValue, endValue, holidayValue) {
  const start = Math.trunc(toNumber(startValue));
  const end = Math.trunc(toNumber(endValue));
  if (isError(start)) return start;
  if (isError(end)) return end;
  const holidays = holidaySet(holidayValue);
  const direction = start <= end ? 1 : -1;
  let count = 0;
  for (let cursor = start; direction > 0 ? cursor <= end : cursor >= end; cursor += direction) {
    if (isWorkdaySerial(cursor, holidays)) count += direction;
  }
  return count;
}

module.exports = {
  serialFromDate,
  dateSerialFromMs,
  dateSerial,
  timeSerial,
  serialToParts,
  serialToUtcDate,
  datePart,
  addMonths,
  holidaySet,
  isWorkdaySerial,
  workday,
  networkdays
};
