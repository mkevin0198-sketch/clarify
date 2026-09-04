package cl.clarify.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

final class BluetoothPrefs {
    private static final String PREFS = "clarify_bluetooth";
    private static final String LEGACY_ADDRESS = "car_address";
    private static final String LEGACY_NAME = "car_name";
    private static final String ADDRESSES = "car_addresses";
    private static final String CONNECTED = "connected_addresses";
    private static final String ENABLED = "enabled";
    private static final String PENDING_START = "pending_auto_start";
    private static final String PENDING_FINISH = "pending_auto_finish";
    private static final String DISCONNECT_DEADLINE = "disconnect_deadline";

    private BluetoothPrefs() {}
    static SharedPreferences prefs(Context context) { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    static Set<String> addresses(Context context) {
        Set<String> stored = prefs(context).getStringSet(ADDRESSES, Collections.emptySet());
        Set<String> result = new HashSet<>(stored == null ? Collections.emptySet() : stored);
        String legacy = prefs(context).getString(LEGACY_ADDRESS, "");
        if (result.isEmpty() && legacy != null && !legacy.isBlank()) result.add(legacy);
        return result;
    }
    static boolean contains(Context context, String address) { if (address == null) return false; for (String selected : addresses(context)) if (selected.equalsIgnoreCase(address)) return true; return false; }
    static String address(Context context) { return addresses(context).stream().findFirst().orElse(""); }
    static String name(Context context) {
        Set<String> names = new HashSet<>();
        for (String address : addresses(context)) names.add(nameFor(context, address));
        names.removeIf(String::isBlank);
        return names.isEmpty() ? "" : String.join(" · ", names);
    }
    static String nameFor(Context context, String address) {
        String value = prefs(context).getString("device_name_" + normalize(address), "");
        if (!value.isBlank()) return value;
        if (address != null && address.equalsIgnoreCase(prefs(context).getString(LEGACY_ADDRESS, ""))) return prefs(context).getString(LEGACY_NAME, "");
        return "Dispositivo Bluetooth";
    }
    static boolean enabled(Context context) { return prefs(context).getBoolean(ENABLED, false); }
    static void saveSelection(Context context, Set<String> addresses, java.util.Map<String, String> names) {
        SharedPreferences.Editor editor = prefs(context).edit().putStringSet(ADDRESSES, new HashSet<>(addresses)).putBoolean(ENABLED, !addresses.isEmpty()).putLong(DISCONNECT_DEADLINE, 0L).putBoolean(PENDING_FINISH, false);
        for (java.util.Map.Entry<String, String> item : names.entrySet()) editor.putString("device_name_" + normalize(item.getKey()), item.getValue());
        editor.remove(LEGACY_ADDRESS).remove(LEGACY_NAME).apply(); retainConnected(context);
    }
    static void setEnabled(Context context, boolean enabled) { SharedPreferences.Editor editor=prefs(context).edit().putBoolean(ENABLED, enabled); if(!enabled)editor.putLong(DISCONNECT_DEADLINE,0L).putBoolean(PENDING_START,false).putBoolean(PENDING_FINISH,false); editor.apply(); }
    static void forget(Context context) { prefs(context).edit().clear().apply(); }
    static Set<String> connected(Context context) { return new HashSet<>(prefs(context).getStringSet(CONNECTED, Collections.emptySet())); }
    static boolean anyConnected(Context context) { Set<String> selected = addresses(context); for (String value : connected(context)) if (containsIgnoreCase(selected, value)) return true; return false; }
    static void setConnected(Context context, String address, boolean connected) {
        Set<String> values = connected(context); values.removeIf(value -> value.equalsIgnoreCase(address));
        if (connected && contains(context, address)) values.add(address);
        prefs(context).edit().putStringSet(CONNECTED, values).apply();
    }
    private static void retainConnected(Context context) { Set<String> values = connected(context); values.removeIf(value -> !contains(context, value)); prefs(context).edit().putStringSet(CONNECTED, values).apply(); }
    private static boolean containsIgnoreCase(Set<String> values, String target) { for (String value : values) if (value.equalsIgnoreCase(target)) return true; return false; }
    static void setPendingStart(Context context, boolean pending) { prefs(context).edit().putBoolean(PENDING_START, pending).apply(); }
    static boolean consumePendingStart(Context context) { boolean value=prefs(context).getBoolean(PENDING_START, false); if(value)prefs(context).edit().putBoolean(PENDING_START, false).apply(); return value; }
    static void setPendingFinish(Context context, boolean pending) { prefs(context).edit().putBoolean(PENDING_FINISH, pending).apply(); }
    static boolean consumePendingFinish(Context context) { boolean value=prefs(context).getBoolean(PENDING_FINISH, false); if(value)prefs(context).edit().putBoolean(PENDING_FINISH, false).apply(); return value; }
    static void setDisconnectDeadline(Context context, long deadline) { prefs(context).edit().putLong(DISCONNECT_DEADLINE, deadline).apply(); }
    static long disconnectDeadline(Context context) { return prefs(context).getLong(DISCONNECT_DEADLINE, 0L); }
    private static String normalize(String value) { return value == null ? "" : value.replace(":", "_").toUpperCase(java.util.Locale.ROOT); }
}
