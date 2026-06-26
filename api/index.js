/**
 * Vercel serverless entry — routes /api/* to the Express tutor app.
 * Local dev uses `node src/index.js` instead.
 */
import serverless from "serverless-http";
import { app, ensureReady } from "./src/index.js";

const handler = serverless(app);
let ready;

export default async function vercelHandler(req, res) {
  if (!ready) ready = ensureReady();
  await ready;
  return handler(req, res);
}
