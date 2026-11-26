import { describe, expect, test } from '@jest/globals';
import { capitalizeFirstLetter, EmailSchema, HyperlinkSchema, quickHash } from './strings.js';

describe('Strings utils functions', () => {
  describe('capitalizeFirstLetter', () => {
    test('should return empty on empty string', () => {
      expect(capitalizeFirstLetter('')).toBe('');
    });

    test('should return the same if first letter is a number', () => {
      expect(capitalizeFirstLetter('1')).toBe('1');
    });

    test('should capitalize first letter for a single word', () => {
      expect(capitalizeFirstLetter('duhnny')).toBe('Duhnny');
    });

    test('should capitalize only first letter for multiple words', () => {
      expect(capitalizeFirstLetter('duhnny is the programmer of the month')).toBe('Duhnny is the programmer of the month');
    });
  });

  describe('EmailSchema', () => {
    test('should parse correctly', () => {
      const parseResult = EmailSchema.safeParse('example@email.com');

      expect(parseResult.success).toBe(true);
    });

    test('should fail for some random string', () => {
      const parseResult = EmailSchema.safeParse('some sandom string');

      expect(parseResult.success).toBe(false);
    });

    test('should fail for forbidden characters', () => {
      for (const forbiddenString of ['@', ':', '.', ';', '(', ')', '<', '>']) {
        const parseResult = EmailSchema.safeParse(forbiddenString + '@email.com');

        expect(parseResult.success).toBe(false);
      }
    });
  });

  describe('HyperlinkSchema', () => {
    test('should parse correctly for https', () => {
      const parseResult = HyperlinkSchema.safeParse('https://google.com');

      expect(parseResult.success).toBe(true);
    });

    test('should parse correctly for http', () => {
      const parseResult = HyperlinkSchema.safeParse('http://google.com');

      expect(parseResult.success).toBe(true);
    });

    test('should fail for some random string', () => {
      const parseResult = HyperlinkSchema.safeParse('some sandom string');

      expect(parseResult.success).toBe(false);
    });

    test('should fail for forbidden characters', () => {
      for (const forbiddenString of ['@', ':', '.', ';', '(', ')', '<', '>']) {
        const parseResult = HyperlinkSchema.safeParse(forbiddenString + '.com');

        expect(parseResult.success).toBe(false);
      }
    });

    test('should pass for subpaths and query string', () => {
      const parseResult = HyperlinkSchema.safeParse('https://google.com/subpath?query1=value1&query2=value2');

      expect(parseResult.success).toBe(true);
    });

    test('should pass for different protocols', () => {
      for (const protocol of ['postgresql', 'tcp', 'udp']) {
        const parseResult = HyperlinkSchema.safeParse(protocol + '://google.com');

        expect(parseResult.success).toBe(true);
      }
    });
  });

  describe('quickHash', () => {
    test('should produce two different hashes on subsequent calls', () => {
      expect(quickHash()).not.toBe(quickHash());
    });
  });
})
