import { Router } from "@oak/oak";
import { eventsWsHandler } from "./ws-handler.ts";

const eventsRouter = new Router();

// Auth is handled inline in the handler — browsers cannot send custom headers
// on a WebSocket handshake, so JWT verification reads the
// `Sec-WebSocket-Protocol: bearer.<jwt>` subprotocol entry.
eventsRouter.get("/events/ws", eventsWsHandler);

export default eventsRouter;
