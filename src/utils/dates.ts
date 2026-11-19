export const getStartOfWeek = (from: Temporal.ZonedDateTime) => {
  const daysToSubtract = from.dayOfWeek % 7; // mod 7 because Sunday is the first day of week

  const firstDayOfWeek = from.subtract({ days: daysToSubtract });

  return firstDayOfWeek.startOfDay();
}

export const getStartOfMonth = (from: Temporal.ZonedDateTime) => {
  const daysToSubtract = from.day - 1;

  const firstDayOfMonth = from.subtract({ days: daysToSubtract });

  return firstDayOfMonth.startOfDay();
}

export const getEndOfWeek = (from: Temporal.ZonedDateTime) => {
  const daysToAdd = 7 - (from.dayOfWeek % 7); // mod 7 because Sunday is the first day of week

  const firstDayOfNextWeek = from.add({ days: daysToAdd });

  const startOfFirstDayOfNextWeek = firstDayOfNextWeek.startOfDay();

  return startOfFirstDayOfNextWeek.subtract({ nanoseconds: 1 }); // smallest precision
}

export const getEndOfMonth = (from: Temporal.ZonedDateTime) => {
  const daysToAdd = from.daysInMonth - from.day;

  const firstDayOfNextMonth = from.add({ days: daysToAdd });

  const startOfFirstDayOfNextMonth = firstDayOfNextMonth.startOfDay();

  return startOfFirstDayOfNextMonth.subtract({ nanoseconds: 1 }); // smallest precision
}
