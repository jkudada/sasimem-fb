/**
 * Every ops script acts on exactly the project named on its command line. There is no
 * default, the emulator's demo- projects are refused, and production needs its owner to
 * say so (--i-am-the-owner): these scripts are run against sasimem-dev while building,
 * and against sasimem-prod only by the person who owns it.
 */
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const PRODUCTION = "sasimem-prod";

export function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const arg = argv[i] ?? "";
  return arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[i + 1];
}

export const has = (argv: readonly string[], name: string): boolean => argv.includes(`--${name}`);

export function projectFrom(argv: readonly string[]): string {
  const project = flag(argv, "project");
  if (project === undefined || project === "") throw new Error("Name the project: --project <id>. There is no default.");
  if (!PROJECT_ID.test(project)) throw new Error(`"${project}" is not a project ID.`);
  if (project.startsWith("demo-")) throw new Error(`${project} is an emulator project; these scripts act on real projects.`);
  if (project === PRODUCTION && !has(argv, "i-am-the-owner")) {
    throw new Error(`${PRODUCTION} is production. Its owner runs this, adding --i-am-the-owner.`);
  }
  return project;
}
