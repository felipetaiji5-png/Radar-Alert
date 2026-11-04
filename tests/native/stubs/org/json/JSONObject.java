package org.json;

import java.util.HashMap;
import java.util.Map;

/** Test-only shim for native cache's metadata, not a JSON implementation. */
public final class JSONObject {
    private final Map<String, Object> values = new HashMap<>();
    public JSONObject put(String name, Object value) { values.put(name, value); return this; }
    public JSONObject optJSONObject(String name) {
        Object value = values.get(name);
        return value instanceof JSONObject ? (JSONObject) value : null;
    }
    public double optDouble(String name, double fallback) {
        Object value = values.get(name);
        return value instanceof Number ? ((Number)value).doubleValue() : fallback;
    }
}
