import { TomlParser } from '../util/toml.js';
import { PackageManifest } from '../model/manifest.js';
import fs from 'fs';
import path from 'path';

export class NewCommand {
  constructor(private projectDir: string) {}

  async run(name: string): Promise<void> {
    const targetDir = path.join(this.projectDir, name);
    if (fs.existsSync(targetDir)) {
      console.error(`Directory already exists: ${name}/`);
      return;
    }

    fs.mkdirSync(targetDir, { recursive: true });

    // Derive Kotlin class name from package name: ink.mobs -> InkMobs
    const className = name
      .split(/[.\-]/)
      .map(s => s.charAt(0).toUpperCase() + s.slice(1))
      .join('');

    // Write ink-package.toml
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

    // Write src/grammar.ts
    fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, 'src/grammar.ts'),
      `import { defineGrammar, declaration, rule } from '@inklang/quill/grammar'

export default defineGrammar({
  package: '${name}',
  declarations: [
    declaration({
      keyword: 'mykeyword',
      inheritsBase: true,
      rules: [
        rule('my_rule', r => r.identifier())
      ]
    })
  ]
})
`
    );

    // Write scripts/main.ink
    fs.mkdirSync(path.join(targetDir, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, 'scripts/main.ink'),
      `// ${name} v0.1.0\n`
    );

    // Write runtime/build.gradle.kts
    const runtimeDir = path.join(targetDir, 'runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(
      path.join(runtimeDir, 'build.gradle.kts'),
      `plugins {
    kotlin("jvm") version "1.9.22"
}

group = "${name}"
version = "0.1.0"

repositories {
    mavenCentral()
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:1.20.4-R0.1-SNAPSHOT")
}

kotlin {
    jvmToolchain(17)
}
`
    );

    // Write runtime/src/main/kotlin/<ClassName>Runtime.kt
    const ktDir = path.join(runtimeDir, 'src/main/kotlin');
    fs.mkdirSync(ktDir, { recursive: true });
    fs.writeFileSync(
      path.join(ktDir, `${className}Runtime.kt`),
      `package ${name}

class ${className}Runtime {
    // Implement InkRuntimePackage interface here
}
`
    );

    console.log(`Created package: ${name}/`);
    console.log('  ink-package.toml');
    console.log('  src/grammar.ts');
    console.log('  scripts/main.ink');
    console.log('  runtime/build.gradle.kts');
    console.log(`  runtime/src/main/kotlin/${className}Runtime.kt`);
  }
}
