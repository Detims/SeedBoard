import { buildApp } from "./app.js";
import { integratedScanRunner } from "./integratedScanner.js";

const app = buildApp({ scanner: integratedScanRunner });
const port = Number(process.env.PORT ?? "4317");

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new TypeError("PORT must be an integer between 1 and 65535.");
}

try {
  await app.listen({ host: "127.0.0.1", port });
  console.log(`Modernizer API listening on http://127.0.0.1:${port}`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
} finally {
  const stop = async () => {
    await app.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
