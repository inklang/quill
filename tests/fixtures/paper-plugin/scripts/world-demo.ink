using ink.paper

// Shows world info when a player joins
player WorldGreeter {
  on_join {
    let t = world.time
    let w = world.weather
    let n = world.name

    java.call(player, "sendMessage", "--- " + n + " ---")
    java.call(player, "sendMessage", "Time: " + java.toString(t))
    java.call(player, "sendMessage", "Weather: " + w)

    // Check the block below the player
    let loc = java.call(player, "getLocation")
    let px = java.call(loc, "getBlockX")
    let py = java.call(loc, "getBlockY") - 1
    let pz = java.call(loc, "getBlockZ")
    let block = world.getBlock(px, py, pz)

    java.call(player, "sendMessage", "Standing on: " + block.type)
    java.call(player, "sendMessage", "Biome: " + block.biome)
  }
}

// Pig that marks its death location with a redstone block
mob Pig {
  on_spawn {
    print("A pig spawned in " + world.name)
  }

  on_death {
    let loc = java.call(entity, "getLocation")
    let x = java.call(loc, "getBlockX")
    let y = java.call(loc, "getBlockY")
    let z = java.call(loc, "getBlockZ")
    world.setBlock(x, y, z, "redstone_block")
    print("Pig fell at " + java.toString(x) + ", " + java.toString(y) + ", " + java.toString(z))
  }
}

// Set time to day and clear weather
command setday {
  world.set_time(1000)
  world.set_weather("clear")
  java.call(sender, "sendMessage", "Set day and cleared weather")
}

// Spawn a pig near the player
command spawnpig {
  let loc = java.call(sender, "getLocation")
  let px = java.call(loc, "getX")
  let py = java.call(loc, "getY")
  let pz = java.call(loc, "getZ")
  let pig = world.spawnEntity("pig", px, py, pz)
  java.call(sender, "sendMessage", "Spawned a " + pig.type + "!")
}
