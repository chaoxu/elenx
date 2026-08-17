const limit = 1_550;
const files = [...new Bun.Glob("**/*.ts").scanSync({ cwd: "src" })].sort();
let lines = 0;
for (const file of files) {
  const source = await Bun.file(`src/${file}`).text();
  lines += source
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;
}
console.log(`${lines} nonblank source lines (limit ${limit})`);
if (lines > limit) process.exit(1);
