plugins {
    kotlin("jvm") version "2.2.21"
}

group = "org.inklang"
version = "0.1.0"

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
}

// Both deps are compileOnly — provided at runtime by ink-bukkit's classloader
val inkJar = file("../../../../../../ink/ink/build/libs/ink-1.0-SNAPSHOT.jar")

dependencies {
    compileOnly("io.papermc.paper:paper-api:1.21.11-R0.1-SNAPSHOT")
    compileOnly(files(inkJar))
}

tasks.jar {
    archiveFileName.set("ink-paper-0.1.0.jar")
}

kotlin {
    jvmToolchain(21)
}
