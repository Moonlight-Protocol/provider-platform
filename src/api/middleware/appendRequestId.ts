import { Context } from "@oak/oak";

export async function appendRequestIdMiddleware(
  ctx: Context,
  next: () => Promise<unknown>
) {
  const requestId = crypto.randomUUID();
  ctx.state.requestId = requestId;
  console.log(`Incoming request with ID: ${requestId}`);
  await next();
}
