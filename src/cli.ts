import { run } from './cli-main';

run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  stdin: process.stdin,
}).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.stderr.write('hey-receipt: unexpected failure\n');
    process.exitCode = 6;
  },
);
