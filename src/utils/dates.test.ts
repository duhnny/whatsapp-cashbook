import { describe, expect, test } from '@jest/globals';
import { getEndOfMonth, getEndOfWeek, getStartOfMonth, getStartOfWeek } from './dates.js';

interface Day {
  year: number
  month: number
  day: number
}

describe('Test date utils functions', () => {
  const daysInWeek: Day[] = [
    {
      // Sunday
      year: 1999,
      month: 12,
      day: 26,
    },
    {
      // Monday
      year: 1999,
      month: 12,
      day: 27,
    },
    {
      // ...
      year: 1999,
      month: 12,
      day: 28,
    },
    {
      year: 1999,
      month: 12,
      day: 29,
    },
    {
      year: 1999,
      month: 12,
      day: 30,
    },
    {
      year: 1999,
      month: 12,
      day: 31,
    },
    {
      year: 2000,
      month: 1,
      day: 1,
    },
  ];

  describe('getStartOfWeek', () => {
    test('should return the same result for all days in same week', () => {
      for (const day of daysInWeek) {
        const from = Temporal.ZonedDateTime.from({
          timeZone: 'UTC',
          year: day.year,
          month: day.month,
          day: day.day,
        });

        const startOfWeek = getStartOfWeek(from);

        expect(startOfWeek.year).toBe(1999);
        expect(startOfWeek.month).toBe(12);
        expect(startOfWeek.day).toBe(26);
      }
    });

    test('should return the very beginning of the day', () => {
      const from = Temporal.ZonedDateTime.from({
        timeZone: 'UTC',
        year: 2000,
        month: 1,
        day: 1,
      });

      const startOfWeek = getStartOfWeek(from);

      expect(startOfWeek.hour).toBe(0);
      expect(startOfWeek.minute).toBe(0);
      expect(startOfWeek.second).toBe(0);
      expect(startOfWeek.millisecond).toBe(0);
      expect(startOfWeek.microsecond).toBe(0);
      expect(startOfWeek.nanosecond).toBe(0);
    });
  });

  describe('getEndOfWeek', () => {
    test('should return the same result for all days in same week', () => {
      for (const day of daysInWeek) {
        const from = Temporal.ZonedDateTime.from({
          timeZone: 'UTC',
          year: day.year,
          month: day.month,
          day: day.day,
        });

        const endOfWeek = getEndOfWeek(from);

        expect(endOfWeek.year).toBe(2000);
        expect(endOfWeek.month).toBe(1);
        expect(endOfWeek.day).toBe(1);
      }
    });

    test('should return the very beginning of the day', () => {
      const from = Temporal.ZonedDateTime.from({
        timeZone: 'UTC',
        year: 2000,
        month: 1,
        day: 1,
      });

      const endOfWeek = getEndOfWeek(from);

      expect(endOfWeek.hour).toBe(23);
      expect(endOfWeek.minute).toBe(59);
      expect(endOfWeek.second).toBe(59);
      expect(endOfWeek.millisecond).toBe(999);
      expect(endOfWeek.microsecond).toBe(999);
      expect(endOfWeek.nanosecond).toBe(999);
    });
  });

  const daysInMonth: Day[] =
    Array.from({ length: 31 }, (_, i) => {
      return {
        year: 2000,
        month: 1,
        day: i+1,
      };
    });

  describe('getStartOfMonth', () => {
    test('should return the same result for all days in same month', () => {
      for (const day of daysInMonth) {
        const from = Temporal.ZonedDateTime.from({
          timeZone: 'UTC',
          year: day.year,
          month: day.month,
          day: day.day,
        });

        const startOfMonth = getStartOfMonth(from);

        expect(startOfMonth.year).toBe(2000);
        expect(startOfMonth.month).toBe(1);
        expect(startOfMonth.day).toBe(1);
      }
    });

    test('should return the very beginning of the day', () => {
      const from = Temporal.ZonedDateTime.from({
        timeZone: 'UTC',
        year: 2000,
        month: 1,
        day: 1,
      });

      const startOfMonth = getStartOfMonth(from);

      expect(startOfMonth.hour).toBe(0);
      expect(startOfMonth.minute).toBe(0);
      expect(startOfMonth.second).toBe(0);
      expect(startOfMonth.millisecond).toBe(0);
      expect(startOfMonth.microsecond).toBe(0);
      expect(startOfMonth.nanosecond).toBe(0);
    });
  });

  describe('getEndOfMonth', () => {
    test('should return the same result for all days in same month', () => {
      for (const day of daysInMonth) {
        const from = Temporal.ZonedDateTime.from({
          timeZone: 'UTC',
          year: day.year,
          month: day.month,
          day: day.day,
        });

        const endOfMonth = getEndOfMonth(from);

        expect(endOfMonth.year).toBe(2000);
        expect(endOfMonth.month).toBe(1);
        expect(endOfMonth.day).toBe(31);
      }
    });

    test('should return the very beginning of the day', () => {
      const from = Temporal.ZonedDateTime.from({
        timeZone: 'UTC',
        year: 2000,
        month: 1,
        day: 1,
      });

      const endOfMonth = getEndOfMonth(from);

      expect(endOfMonth.hour).toBe(23);
      expect(endOfMonth.minute).toBe(59);
      expect(endOfMonth.second).toBe(59);
      expect(endOfMonth.millisecond).toBe(999);
      expect(endOfMonth.microsecond).toBe(999);
      expect(endOfMonth.nanosecond).toBe(999);
    });
  });
});
