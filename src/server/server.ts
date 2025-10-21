import app from "./router.ts";
import { PORT } from "../config/env.ts";
// import { logger } from "./middleware.ts";

// app.use(logger);

console.log(`🚀 Executer Server running on http://localhost:${PORT}`);

await app.listen({ port: Number(PORT) });
