import * as colorette from 'colorette';

// Semantic color helpers — always on (no flag support)
export const cli = {
  /** Green — success, completion */
  success: (text: string) => colorette.green(text),

  /** Red — errors, failures */
  error: (text: string) => colorette.red(text),

  /** Cyan — info labels, section headers, metadata */
  info: (text: string) => colorette.cyan(text),

  /** Yellow — warnings */
  warn: (text: string) => colorette.yellow(text),

  /** Bold white — package names, versions */
  bold: (text: string) => colorette.bold(text),

  /** Gray — muted / secondary text */
  muted: (text: string) => colorette.gray(text),
};

export const print = {
  success: (text: string) => console.log(cli.success(text)),
  error: (text: string) => console.error(cli.error(text)),
  info: (text: string) => console.log(cli.info(text)),
  warn: (text: string) => console.log(cli.warn(text)),
  bold: (text: string) => console.log(cli.bold(text)),
  muted: (text: string) => console.log(cli.muted(text)),
};
