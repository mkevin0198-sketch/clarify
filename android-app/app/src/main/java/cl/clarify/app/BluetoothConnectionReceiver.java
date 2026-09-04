package cl.clarify.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.bluetooth.BluetoothDevice;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.SystemClock;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

public class BluetoothConnectionReceiver extends BroadcastReceiver {
    static final String ACTION_AUTO_START = "cl.clarify.app.AUTO_START";
    static final String ACTION_AUTO_FINISH = "cl.clarify.app.AUTO_FINISH";
    private static final String ACTION_CONFIRM_DISCONNECT = "cl.clarify.app.CONFIRM_BLUETOOTH_DISCONNECT";
    private static final String CHANNEL_ID = "clarify_car_connection";
    private static final int REQUEST_DISCONNECT = 1917;
    static final long DISCONNECT_GRACE_MS = 30_000L;

    @Override public void onReceive(Context context, Intent intent) {
        if (!BluetoothPrefs.enabled(context)) return;
        String action = intent.getAction();
        if (ACTION_CONFIRM_DISCONNECT.equals(action)) { confirmDisconnect(context); return; }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) return;
        BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
        if (device == null || !BluetoothPrefs.contains(context, device.getAddress())) return;
        if (BluetoothDevice.ACTION_ACL_CONNECTED.equals(action)) {
            BluetoothPrefs.setConnected(context, device.getAddress(), true);
            cancelDisconnect(context);
            BluetoothPrefs.setPendingStart(context, true);
            showNotification(context, "Clarify listo para conducir", BluetoothPrefs.nameFor(context, device.getAddress()) + " conectado · iniciando viaje", ACTION_AUTO_START, 1916);
            launch(context, ACTION_AUTO_START);
        } else if (BluetoothDevice.ACTION_ACL_DISCONNECTED.equals(action)) {
            BluetoothPrefs.setConnected(context, device.getAddress(), false);
            if (!BluetoothPrefs.anyConnected(context)) scheduleDisconnect(context);
        }
    }

    private static void scheduleDisconnect(Context context) {
        if (!hasActiveTrip(context)) return;
        BluetoothPrefs.setDisconnectDeadline(context, System.currentTimeMillis() + DISCONNECT_GRACE_MS);
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        if (manager != null) manager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + DISCONNECT_GRACE_MS, disconnectIntent(context));
    }
    private static void cancelDisconnect(Context context) {
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        if (manager != null) manager.cancel(disconnectIntent(context));
        BluetoothPrefs.setDisconnectDeadline(context, 0L); BluetoothPrefs.setPendingFinish(context, false);
    }
    private static PendingIntent disconnectIntent(Context context) {
        Intent check = new Intent(context, BluetoothConnectionReceiver.class).setAction(ACTION_CONFIRM_DISCONNECT);
        return PendingIntent.getBroadcast(context, REQUEST_DISCONNECT, check, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private static void confirmDisconnect(Context context) {
        long deadline = BluetoothPrefs.disconnectDeadline(context);
        if (deadline <= 0 || System.currentTimeMillis() < deadline || BluetoothPrefs.anyConnected(context) || !hasActiveTrip(context)) return;
        BluetoothPrefs.setDisconnectDeadline(context, 0L); BluetoothPrefs.setPendingFinish(context, true);
        showNotification(context, "Viaje finalizado", "Bluetooth del auto desconectado durante 30 segundos", ACTION_AUTO_FINISH, 1917);
        launch(context, ACTION_AUTO_FINISH);
    }
    private static boolean hasActiveTrip(Context context) { return !context.getSharedPreferences("clarify_car_state", Context.MODE_PRIVATE).getString("navigation_state", "").isBlank(); }
    private static void launch(Context context, String action) {
        Intent launch = new Intent(context, MainActivity.class).setAction(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try { context.startActivity(launch); } catch (RuntimeException ignored) { }
    }
    private static void showNotification(Context context, String title, String body, String action, int id) {
        NotificationManager manager = context.getSystemService(NotificationManager.class); if (manager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) manager.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "Conexión con el auto", NotificationManager.IMPORTANCE_HIGH));
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        Intent open = new Intent(context, MainActivity.class).setAction(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        manager.notify(id, new NotificationCompat.Builder(context, CHANNEL_ID).setSmallIcon(cl.clarify.app.R.drawable.ic_launcher).setContentTitle(title).setContentText(body).setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(true).setContentIntent(pending).build());
    }
}
