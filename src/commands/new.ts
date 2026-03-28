import { TomlParser } from '../util/toml.js';
import { PackageManifest } from '../model/manifest.js';
import { readRc } from '../util/keys.js';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { success as splash } from '../ui/ascii.js';
import { print } from '../ui/colors.js';

const TEMPLATES = ['blank', 'hello-world', 'full'] as const;
type Template = typeof TEMPLATES[number];

function templateContent(name: string, template: Template): string {
  switch (template) {
    case 'blank':
      return `// ${name}\n`;
    case 'hello-world':
      return `print("Hello, world!")\n`;
    case 'full':
      return `// ${name} v0.1.0\n\nfn greet(name) {\n  print("Hello, " + name + "!")\n}\n\ngreet("world")\n`;
    default: {
      const _: never = template;
      throw new Error(`Unknown template: ${template}`);
    }
  }
}

async function promptTemplate(): Promise<Template> {
  // Non-TTY: default to blank
  if (!process.stdin.isTTY) return 'blank';

  // Show logged-in status
  try {
    const rc = readRc();
    if (rc) {
      console.log(`Logged in as ${rc.username}`);
    }
  } catch {}

  console.log('\n? Select a template:');
  console.log('  [1] blank        — empty project');
  console.log('  [2] hello-world  — starter script');
  console.log('  [3] full         — example project');

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.once('SIGINT', () => {
      rl.close();
      process.exit(130);
    });
    const ask = () => {
      rl.question('\nEnter number (default: 1): ', (answer) => {
        const t = answer.trim();
        if (t === '' || t === '1') { rl.close(); resolve('blank'); }
        else if (t === '2') { rl.close(); resolve('hello-world'); }
        else if (t === '3') { rl.close(); resolve('full'); }
        else { ask(); }
      });
    };
    ask();
  });
}

export interface NewCommandOptions {
  isPackage: boolean;
  template?: string;
}

export class NewCommand {
  constructor(private projectDir: string) {}

  async run(name: string, opts: NewCommandOptions = { isPackage: false }): Promise<void> {
    const targetDir = path.join(this.projectDir, name);
    if (fs.existsSync(targetDir)) {
      console.error(`Error: Directory already exists: ${name}/`);
      process.exit(1);
    }

    if (opts.isPackage) {
      await this.scaffoldPackage(name, targetDir);
    } else {
      const template = (opts.template as Template | undefined) ?? await promptTemplate();
      await this.scaffoldProject(name, targetDir, template);
    }
  }

  private async scaffoldProject(name: string, targetDir: string, template: Template): Promise<void> {
    fs.mkdirSync(targetDir, { recursive: true });

    // Resolve author from ~/.quillrc
    let author: string | undefined;
    try {
      const rc = readRc();
      if (rc) {
        author = rc.username;
      }
    } catch {}

    const manifest: PackageManifest = {
      name,
      version: '0.1.0',
      main: 'main',
      dependencies: {},
      ...(author ? { author } : {}),
    };

    fs.writeFileSync(
      path.join(targetDir, 'ink-package.toml'),
      TomlParser.write(manifest)
    );

    fs.mkdirSync(path.join(targetDir, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, 'scripts/main.ink'),
      templateContent(name, template)
    );

    console.log(`Created project: ${name}/`);
    console.log('  ink-package.toml');
    console.log('  scripts/main.ink');
  }

  private async scaffoldPackage(name: string, targetDir: string): Promise<void> {
    fs.mkdirSync(targetDir, { recursive: true });

    const className = name
      .split(/[.\-]/)
      .filter(Boolean)
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
      .join('');

    const manifest: PackageManifest = {
      name,
      version: '0.1.0',
      main: 'mod',
      dependencies: {},
      grammar: {
        entry: 'src/grammar.ts',
        output: 'dist/grammar.ir.json',
      },
      runtime: {
        jar: `runtime/build/libs/${name}-0.1.0.jar`,
        entry: `${name}.${className}Runtime`,
      },
    };

    fs.writeFileSync(
      path.join(targetDir, 'ink-package.toml'),
      TomlParser.write(manifest)
    );

    fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, 'src/grammar.ts'),
      `import { defineGrammar, declaration, rule } from '@inklang/quill/grammar'\n\nexport default defineGrammar({\n  package: '${name}',\n  declarations: [\n    declaration({\n      keyword: 'mykeyword',\n      inheritsBase: true,\n      rules: [\n        rule('my_rule', r => r.identifier())\n      ]\n    })\n  ]\n})\n`
    );

    fs.mkdirSync(path.join(targetDir, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, 'scripts/main.ink'),
      `// ${name} v0.1.0\n`
    );

    const runtimeDir = path.join(targetDir, 'runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(
      path.join(runtimeDir, 'settings.gradle.kts'),
      `rootProject.name = "${name}-runtime"\n`
    );
    fs.writeFileSync(
      path.join(runtimeDir, 'build.gradle.kts'),
      `plugins {\n    kotlin("jvm") version "1.9.22"\n    id("io.papermc.paperweight.userdev") version "1.7.1"\n}\n\ngroup = "${name}"\nversion = "0.1.0"\n\nrepositories {\n    mavenCentral()\n}\n\ndependencies {\n    paperweight.paperDevBundle("1.21.4-R0.1-SNAPSHOT")\n}\n\nkotlin {\n    jvmToolchain(21)\n}\n`
    );

    const ktDir = path.join(runtimeDir, 'src/main/kotlin');
    fs.mkdirSync(ktDir, { recursive: true });
    fs.writeFileSync(
      path.join(ktDir, `${className}Runtime.kt`),
      `package ${name}\n\nclass ${className}Runtime {\n    // Implement InkRuntimePackage interface here\n}\n`
    );

    splash.new();
    print.muted(`  Package: ${name}/`);
  }
}
