#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertSnapshot } from "@modernizer/contracts";
import { ModernizerStore } from "@modernizer/api/storage";

type Command = { name?: string; path?: string; file?: string; action: string };

async function main(args: string[]): Promise<void> {
  const command = parseCommand(args);
  if (command.action === "help") {
    printHelp();
    return;
  }

  if (command.action === "validate") {
    const document = JSON.parse(await readFile(resolve(command.file!), "utf8")) as unknown;
    assertSnapshot(document);
    console.log(`Snapshot ${document.id} is valid.`);
    return;
  }

  const store = new ModernizerStore();
  try {
    if (command.action === "list") {
      const projects = store.listProjects();
      if (projects.length === 0) {
        console.log("No local projects are registered.");
        return;
      }
      for (const project of projects) console.log(`${project.name}\t${project.id}`);
      return;
    }

    const project = await store.registerProject({
      rootPath: command.path!,
      ...(command.name === undefined ? {} : { name: command.name }),
    });
    console.log(`Registered ${project.name} (${project.id}).`);
    console.log("The selected folder has not been scanned.");
  } finally {
    store.close();
  }
}

function parseCommand(args: string[]): Command {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return { action: "help" };
  }
  if (args[0] === "project" && args[1] === "list" && args.length === 2) {
    return { action: "list" };
  }
  if (args[0] === "project" && args[1] === "register" && args[2]) {
    let name: string | undefined;
    for (let index = 3; index < args.length; index += 1) {
      const option = args[index];
      if (option === "--name" && args[index + 1]) {
        name = args[index + 1];
        index += 1;
      } else {
        throw new TypeError("Usage: modernizer project register <folder> [--name <label>]");
      }
    }
    return { action: "register", path: args[2], ...(name === undefined ? {} : { name }) };
  }
  if (args[0] === "snapshot" && args[1] === "validate" && args[2] && args.length === 3) {
    return { action: "validate", file: args[2] };
  }
  throw new TypeError("Unknown command. Run modernizer --help.");
}

function printHelp(): void {
  console.log(
    [
      "Modernizer local CLI",
      "",
      "  modernizer project register <folder> [--name <label>]",
      "  modernizer project list",
      "  modernizer snapshot validate <json-file>",
      "  modernizer --help",
      "",
      "Registration stores the selected local folder; it does not read its files.",
    ].join("\n"),
  );
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message =
    error instanceof TypeError ? error.message : "The local command could not be completed.";
  console.error(message);
  process.exitCode = 1;
});
