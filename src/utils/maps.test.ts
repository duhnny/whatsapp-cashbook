import { describe, expect, test } from '@jest/globals';
import { omitKeys, zeroRecordFromEnum } from './maps.js';

const basicEnum = {
  fieldOne: 'fieldOne',
  fieldTwo: 'fieldTwo',
} as const;

describe('Test hashmap utils', () => {
  describe('zeroRecordFromEnum', () => {
    test('should be equal', () => {
      expect(zeroRecordFromEnum(basicEnum)).toStrictEqual({
        fieldOne: 0,
        fieldTwo: 0,
      });
    });
  });

  describe('omitKeys', () => {
    test('should be equal', () => {
      expect(omitKeys(basicEnum, ['fieldOne'])).toStrictEqual({
        fieldTwo: 'fieldTwo',
      });
    });

    test('should remain unchanged when no keys are omitted', () => {
      expect(omitKeys(basicEnum, [])).toStrictEqual(basicEnum);
    });
  });
});
