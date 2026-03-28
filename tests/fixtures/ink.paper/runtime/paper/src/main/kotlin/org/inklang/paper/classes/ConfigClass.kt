package org.inklang.paper.classes

import org.inklang.lang.ClassDescriptor
import org.inklang.lang.Value
import java.io.File

object ConfigClass {
    fun create(name: String, data: MutableMap<String, Value>, file: File): Value.Instance {
        val descriptor = ClassDescriptor(
            name = "Config",
            superClass = null,
            readOnly = false,
            methods = mapOf(
                "get" to Value.NativeFunction { args ->
                    val key = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    data[key] ?: Value.Null
                },
                "set" to Value.NativeFunction { args ->
                    val key = (args.getOrNull(0) as? Value.String)?.value ?: return@NativeFunction Value.Null
                    val value = args.getOrNull(1) ?: Value.Null
                    data[key] = value
                    Value.Null
                },
                "save" to Value.NativeFunction { _ ->
                    saveYaml(file, data)
                    Value.Null
                },
                "reload" to Value.NativeFunction { _ ->
                    val reloaded = loadYaml(file)
                    data.clear()
                    data.putAll(reloaded)
                    Value.Null
                }
            )
        )
        return Value.Instance(descriptor, data.toMutableMap())
    }

    fun loadYaml(file: File): MutableMap<String, Value> {
        val result = mutableMapOf<String, Value>()
        if (!file.exists()) return result
        for (line in file.readLines()) {
            val trimmed = line.trim()
            if (trimmed.isEmpty() || trimmed.startsWith("#")) continue
            val colonIdx = trimmed.indexOf(':')
            if (colonIdx < 0) continue
            val key = trimmed.substring(0, colonIdx).trim()
            val raw = trimmed.substring(colonIdx + 1).trim()
            result[key] = parseYamlValue(raw)
        }
        return result
    }

    fun saveYaml(file: File, data: Map<String, Value>) {
        val lines = data.map { (k, v) -> "$k: ${formatYamlValue(v)}" }
        file.parentFile.mkdirs()
        file.writeText(lines.joinToString("\n"))
    }

    private fun parseYamlValue(raw: String): Value = when {
        raw == "true" -> Value.Boolean(true)
        raw == "false" -> Value.Boolean(false)
        raw.startsWith("\"") && raw.endsWith("\"") -> Value.String(raw.removeSurrounding("\""))
        raw.toIntOrNull() != null -> Value.Int(raw.toInt())
        raw.toDoubleOrNull() != null -> Value.Double(raw.toDouble())
        else -> Value.String(raw)
    }

    private fun formatYamlValue(v: Value): String = when (v) {
        is Value.Boolean -> v.value.toString()
        is Value.Int -> v.value.toString()
        is Value.Double -> v.value.toString()
        is Value.String -> "\"${v.value}\""
        else -> "\"$v\""
    }
}
