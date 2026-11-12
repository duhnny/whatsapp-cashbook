import z from 'zod';

export const WhatsappCheckPhoneResponseBodySchema = z.object({
  number: z.string(),
  exists: z.boolean(),
  whatsappId: z.string().nullable(),
});

export type WhatsappCheckPhoneResponseBody = z.infer<typeof WhatsappCheckPhoneResponseBodySchema>;

export const WhatsappGetAnonIdResponseBodySchema = z.object({
  number: z.string(),
  lid: z.string().nullable(),
});

export type WhatsappGetAnonIdResponseBody = z.infer<typeof WhatsappGetAnonIdResponseBodySchema>;
