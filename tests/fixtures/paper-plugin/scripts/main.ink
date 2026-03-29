using ink.paper

// -- Players --
player Greeter {
  on_join {
    let name = java.call(player, "getName")
    java.call(player, "sendMessage", "Welcome, " + name + "!")
  }

  on_leave {
    let name = java.call(player, "getName")
    print(name + " left the server")
  }
}

// -- Mobs --
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

// -- Commands --
command setday {
  on_execute {
    world.set_time(1000)
    world.set_weather("clear")
    java.call(sender, "sendMessage", "Set day and cleared weather")
  }
}

command spawnpig {
  on_execute {
    let loc = java.call(sender, "getLocation")
    let px = java.call(loc, "getX")
    let py = java.call(loc, "getY")
    let pz = java.call(loc, "getZ")
    let pig = world.spawnEntity("pig", px, py, pz)
    java.call(sender, "sendMessage", "Spawned a " + pig.type + "!")
  }
}

command heal {
  on_execute {
    java.call(player, "setHealth", 20)
    java.call(sender, "sendMessage", "Healed!")
  }
}

command fly {
  on_execute {
    let flying = java.call(player, "isFlying")
    if flying {
      java.call(player, "setFlying", false)
      java.call(player, "setAllowFlight", false)
      java.call(sender, "sendMessage", "Flight disabled")
    } else {
      java.call(player, "setAllowFlight", true)
      java.call(player, "setFlying", true)
      java.call(sender, "sendMessage", "Flight enabled")
    }
  }
}
