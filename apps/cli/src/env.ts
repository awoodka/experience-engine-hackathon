import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1),
    EE_GEMINI_MODEL: z.string().min(1),
  },
  clientPrefix: "EE_PUBLIC_",
  client: {},
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
