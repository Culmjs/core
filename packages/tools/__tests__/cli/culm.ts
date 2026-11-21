// The command as a child process runs it: `bin/culm.js` imports `dist/`, which a test run has not built.
import { main } from '../../src/cli/main.ts'

process.exitCode = await main(process.argv.slice(2))
