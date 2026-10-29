import z from 'zod';

const WhatsappIdSchema = z.string()
  .regex(/^\d+@(lid|c\.us)$/)
  .transform((val) => {
    const parts = val.split('@');

    const id = parseInt(parts[0]!, 10);
    const kind = parts[1];

    switch (kind) {
      case 'lid':
        return {
          kind: 'anonymous' as const,
          id,
        }

      case 'c.us':
        return {
          kind: 'number' as const,
          id,
        }

      default:
        return z.NEVER
    }
  });

const MessageSchema = z.object({
  id:        z.string(),
  from:      WhatsappIdSchema,
  to:        WhatsappIdSchema,
  timestamp: z.int(),
  fromMe:    z.boolean(),
  isGroup:   z.boolean(),
  contact:   z.object({
    pushName: z.string(),
    name:     z.string(),
  }),
}).and(z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    body: z.string(),
  }),
  z.object({
    type: z.literal('image'),
    body: z.string().optional(),
    media: z.object({
      mimetype: z.enum(['image/jpeg', 'image/png']),
      data: z.base64(),
    }),
  }),
]));

export const UnofficialWebhookBodySchema = z.object({
  event:          z.enum(['message.received']),
  sessionId:      z.string(),
  idempotencyKey: z.string(),
  data: MessageSchema,
});

export type UnofficialWebhookBody = z.infer<typeof UnofficialWebhookBodySchema>;

export const UnofficialWebhookQuerySchema = z.object({
  key: z.string(),
});

export type UnofficialWebhookQuery = z.infer<typeof UnofficialWebhookQuerySchema>;
