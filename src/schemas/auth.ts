import z from 'zod';

export const SignupRequestBodySchema = z.object({
  email: z.email(),
  name: z.string(),
  phone: z.bigint(),
});

export type SignupRequestBody = z.infer<typeof SignupRequestBodySchema>;
