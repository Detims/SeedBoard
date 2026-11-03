import { readFile, writeFile } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";

const schemaPath = new URL("../contracts/snapshot.schema.json", import.meta.url);
const outputPath = new URL("../packages/contracts/src/generated.ts", import.meta.url);
const schemaOutputPath = new URL("../packages/contracts/src/schema.ts", import.meta.url);
const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const generatedTypes = await compile(schema, "Snapshot", {
  bannerComment:
    "/* Generated from contracts/snapshot.schema.json. Run pnpm contracts:generate; do not edit. */",
  unreachableDefinitions: true,
  format: false,
});
const generated = generatedTypes + "\nexport type Snapshot = ModernizerAssessmentSnapshot10;\n";
const embeddedSchema = `/* Generated from contracts/snapshot.schema.json; do not edit. */\nexport const snapshotSchema = ${JSON.stringify(schema, null, 2)} as const;\n`;

if (process.argv.includes("--check")) {
  let current, currentSchema;
  try {
    current = await readFile(outputPath, "utf8");
    currentSchema = await readFile(schemaOutputPath, "utf8");
  } catch {
    current = "";
    currentSchema = "";
  }
  if (current !== generated || currentSchema !== embeddedSchema) {
    console.error("Generated contract artifacts are stale. Run pnpm contracts:generate.");
    process.exitCode = 1;
  } else {
    console.log("Generated contract types match the canonical JSON Schema.");
  }
} else {
  await writeFile(outputPath, generated, "utf8");
  await writeFile(schemaOutputPath, embeddedSchema, "utf8");
  console.log("Generated TypeScript types and validator input from the canonical schema.");
}
