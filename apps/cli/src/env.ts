import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1),
    EE_GEMINI_MODEL: z.string().min(1),
    ANTHROPIC_API_KEY: z.string().min(1),
    EE_ANTHROPIC_MODEL: z.string().default("claude-opus-4-5"),
  },
  clientPrefix: "EE_PUBLIC_",
  client: {},
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
