export interface Io {
  out: (text: string) => void
  err: (text: string) => void
}

const USAGE = `culm - build and edit Culm sites

Usage: culm <command> [options]

Options:
  --help    show this help
`

const stdio: Io = {
  out: text => process.stdout.write(text),
  err: text => process.stderr.write(text),
}

export async function main(argv: string[], io: Io = stdio): Promise<number> {
  if (argv.includes('--help')) {
    io.out(USAGE)
    return 0
  }
  io.err(USAGE)
  return 2
}
