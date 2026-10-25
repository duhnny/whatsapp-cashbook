export const zeroRecordFromEnum = <T extends Record<string, string>>(e: T) => {
  const initialValue: Record<string, number> = {};

  const result = Object.values(e).reduce((acc, currentEnumValue) => {
    acc[currentEnumValue] = 0; // ✅ Sem erro de índice agora!
    return acc;
  }, initialValue);

  return result as Record<T[keyof T], number>;
};
