import z from 'zod';

export const capitalizeFirstLetter = (s: string) => {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

export const EmailSchema = z.email();

export const HyperlinkSchema = z.url();

export const quickHash = () => {
  return Math.random().toString(36).substring(2, 10);
}
