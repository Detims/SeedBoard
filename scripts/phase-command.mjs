const [command = "command", owner = "a later work package"] = process.argv.slice(2);
console.error(
  `"${command}" is defined for the Modernizer workspace; its application target is created in ${owner}.`,
);
process.exitCode = 1;
