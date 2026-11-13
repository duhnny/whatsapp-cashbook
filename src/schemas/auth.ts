import z from 'zod';

export const SignupRequestBodySchema = z.object({
  email: z.email(),
  name: z.string(),
});

export type SignupRequestBody = z.infer<typeof SignupRequestBodySchema>;

export const RequestWhatsappVerificationRequestBodySchema = z.object({
  phone: z.coerce.bigint(),
});

export type RequestWhatsappVerificationRequestBody = z.infer<typeof RequestWhatsappVerificationRequestBodySchema>;
