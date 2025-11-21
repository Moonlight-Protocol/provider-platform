import { MODE, PORT } from "../config/env.ts";

export const statusHandler = (_req: Request): Response => {
  return new Response(JSON.stringify({ mode: MODE, port: PORT }), {
    headers: { "Content-Type": "application/json" },
  });
};
