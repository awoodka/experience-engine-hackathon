import { hc } from "hono/client";
import type { AppType } from "@experience-engine/api/src/index";

export const api = hc<AppType>("/");
