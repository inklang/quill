import { cli, print } from './colors.js';

/** The Quill mascot */
const MASCOT = `   (o>
\\_//)
 \\_/_)
  _|_`;

/**
 * Print a key-moment splash with the mascot and a one-liner message.
 * @param message The contextual message to show below the mascot
 */
export function splash(message: string): void {
  console.log(MASCOT);
  console.log('');
  print.success(`  ${message}`);
  console.log('');
}

/** Shorthand for success-state splashes */
export const success = {
  new: () => splash('Welcome to Quill! Your new package is ready.'),
  build: () => splash('Build complete!'),
  publish: () => splash('Published successfully!'),
  watch: () => splash('Watching for changes...'),
};
