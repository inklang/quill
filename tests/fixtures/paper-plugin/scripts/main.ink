using ink.paper

player Greeter {
  on_join {
    let name = java.call(player, "getName")
    java.call(player, "sendMessage", "Welcome, " + name + "!")
  }
}
