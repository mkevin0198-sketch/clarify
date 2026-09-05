package cl.clarify.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.provider.MediaStore;
import android.net.Uri;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.ViewGroup;
import android.view.View;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.widget.Toast;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;
import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Task;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.Set;

public class MainActivity extends AppCompatActivity {
    private static final String APP_URL = "https://appassets.androidplatform.net/ruta-v2.html";
    private WebView webView;
    private boolean pageReady;
    private boolean pendingAutoStart;
    private boolean pendingAutoFinish;
    private TextToSpeech navigationTts;
    private AudioManager audioManager;
    private AudioFocusRequest navigationAudioFocus;
    private boolean navigationTtsReady;
    private ValueCallback<Uri[]> fileChooserCallback;
    private Uri pendingCameraUri;
    private static final String DRIVE_BACKUP_FILE_NAME = "clarify-backup.json";
    private static final String DRIVE_SCOPE_URL = "https://www.googleapis.com/auth/drive.appdata";
    private GoogleSignInClient googleSignInClient;
    private final ActivityResultLauncher<Intent> driveSignInLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), this::handleDriveSignInResult);
    private final ActivityResultLauncher<String[]> permissionLauncher = registerForActivityResult(new ActivityResultContracts.RequestMultiplePermissions(), result -> {
        sendBluetoothStatus("");
    });
    private final ActivityResultLauncher<Intent> fileChooserLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
        if (fileChooserCallback == null) return;
        Uri[] selected = null;
        if (result.getResultCode() == RESULT_OK) {
            Intent data = result.getData();
            selected = data == null || data.getData() == null
                    ? pendingCameraUri == null ? null : new Uri[]{pendingCameraUri}
                    : WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), data);
        }
        fileChooserCallback.onReceiveValue(selected);
        fileChooserCallback = null;
        pendingCameraUri = null;
    });

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        configureNavigationVoice();
        configureDriveSignIn();
        configureWebView();
        requestInitialPermissions();
        handleIntent(getIntent());
    }

    private void configureDriveSignIn() {
        GoogleSignInOptions options = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestEmail()
                .requestScopes(new Scope(DRIVE_SCOPE_URL))
                .build();
        googleSignInClient = GoogleSignIn.getClient(this, options);
    }

    private void handleDriveSignInResult(ActivityResult result) {
        Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(result.getData());
        try {
            GoogleSignInAccount account = task.getResult(ApiException.class);
            notifyDriveStatus(true, account.getEmail(), null);
        } catch (ApiException error) {
            notifyDriveStatus(false, null, "No se pudo conectar (código " + error.getStatusCode() + ")");
        }
    }

    private boolean isDriveSignedInInternal() {
        GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(this);
        return account != null && GoogleSignIn.hasPermissions(account, new Scope(DRIVE_SCOPE_URL));
    }

    private void notifyDriveStatus(boolean signedIn, String email, String error) {
        if (!pageReady) return;
        try {
            JSONObject payload = new JSONObject()
                    .put("signedIn", signedIn)
                    .put("email", email == null ? JSONObject.NULL : email)
                    .put("error", error == null ? JSONObject.NULL : error);
            webView.post(() -> webView.evaluateJavascript("window.ClarifyNativeDriveStatus&&window.ClarifyNativeDriveStatus(" + JSONObject.quote(payload.toString()) + ")", null));
        } catch (Exception ignored) { }
    }

    private void notifyDriveBackupResult(boolean success, String error) {
        if (!pageReady) return;
        try {
            JSONObject payload = new JSONObject()
                    .put("success", success)
                    .put("error", error == null ? JSONObject.NULL : error)
                    .put("at", System.currentTimeMillis());
            webView.post(() -> webView.evaluateJavascript("window.ClarifyNativeDriveBackupResult&&window.ClarifyNativeDriveBackupResult(" + JSONObject.quote(payload.toString()) + ")", null));
        } catch (Exception ignored) { }
    }

    private void notifyDriveRestoreResult(String jsonContent, String error) {
        if (!pageReady) return;
        try {
            JSONObject payload = new JSONObject()
                    .put("data", jsonContent == null ? JSONObject.NULL : jsonContent)
                    .put("error", error == null ? JSONObject.NULL : error);
            webView.post(() -> webView.evaluateJavascript("window.ClarifyNativeDriveRestoreResult&&window.ClarifyNativeDriveRestoreResult(" + JSONObject.quote(payload.toString()) + ")", null));
        } catch (Exception ignored) { }
    }

    private String getDriveAccessToken() throws Exception {
        GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(this);
        if (account == null || account.getAccount() == null) return null;
        return GoogleAuthUtil.getToken(this, account.getAccount(), "oauth2:" + DRIVE_SCOPE_URL);
    }

    private HttpURLConnection openDriveConnection(String url, String token, String method) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(20000);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        return connection;
    }

    private String readConnectionBody(HttpURLConnection connection) throws Exception {
        int code = connection.getResponseCode();
        if (code < 200 || code >= 300) throw new IllegalStateException("HTTP " + code);
        BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8));
        StringBuilder body = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) body.append(line);
        return body.toString();
    }

    private String findDriveBackupFileId(String token) throws Exception {
        String query = URLEncoder.encode("name='" + DRIVE_BACKUP_FILE_NAME + "' and trashed=false", "UTF-8");
        String url = "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=" + URLEncoder.encode("files(id,name)", "UTF-8") + "&q=" + query;
        HttpURLConnection connection = openDriveConnection(url, token, "GET");
        JSONObject response = new JSONObject(readConnectionBody(connection));
        connection.disconnect();
        JSONArray files = response.optJSONArray("files");
        if (files != null && files.length() > 0) return files.getJSONObject(0).optString("id", null);
        return null;
    }

    private void createDriveBackupFile(String token, String jsonData) throws Exception {
        String boundary = "clarify-" + System.currentTimeMillis();
        JSONObject metadata = new JSONObject().put("name", DRIVE_BACKUP_FILE_NAME).put("parents", new JSONArray().put("appDataFolder"));
        String body = "--" + boundary + "\r\n"
                + "Content-Type: application/json; charset=UTF-8\r\n\r\n" + metadata + "\r\n"
                + "--" + boundary + "\r\n"
                + "Content-Type: application/json; charset=UTF-8\r\n\r\n" + jsonData + "\r\n"
                + "--" + boundary + "--";
        HttpURLConnection connection = openDriveConnection("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", token, "POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "multipart/related; boundary=" + boundary);
        try (OutputStream out = connection.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); }
        readConnectionBody(connection);
        connection.disconnect();
    }

    private void updateDriveBackupFile(String token, String fileId, String jsonData) throws Exception {
        HttpURLConnection connection = openDriveConnection("https://www.googleapis.com/upload/drive/v3/files/" + fileId + "?uploadType=media", token, "PATCH");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
        try (OutputStream out = connection.getOutputStream()) { out.write(jsonData.getBytes(StandardCharsets.UTF_8)); }
        readConnectionBody(connection);
        connection.disconnect();
    }

    private void performDriveBackup(String jsonData) {
        try {
            String token = getDriveAccessToken();
            if (token == null) { notifyDriveBackupResult(false, "Sin sesión de Google"); return; }
            String fileId = findDriveBackupFileId(token);
            if (fileId == null) createDriveBackupFile(token, jsonData);
            else updateDriveBackupFile(token, fileId, jsonData);
            notifyDriveBackupResult(true, null);
        } catch (Exception error) {
            notifyDriveBackupResult(false, error.getMessage());
        }
    }

    private void performDriveRestore() {
        try {
            String token = getDriveAccessToken();
            if (token == null) { notifyDriveRestoreResult(null, "Sin sesión de Google"); return; }
            String fileId = findDriveBackupFileId(token);
            if (fileId == null) { notifyDriveRestoreResult(null, null); return; }
            HttpURLConnection connection = openDriveConnection("https://www.googleapis.com/drive/v3/files/" + fileId + "?alt=media", token, "GET");
            String content = readConnectionBody(connection);
            connection.disconnect();
            notifyDriveRestoreResult(content, null);
        } catch (Exception error) {
            notifyDriveRestoreResult(null, error.getMessage());
        }
    }

    private void configureNavigationVoice() {
        audioManager = getSystemService(AudioManager.class);
        AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
        navigationAudioFocus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener(change -> { })
                .build();
        navigationTts = new TextToSpeech(this, status -> {
            navigationTtsReady = status == TextToSpeech.SUCCESS;
            if (!navigationTtsReady) return;
            int result = navigationTts.setLanguage(new Locale("es", "CL"));
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED)
                navigationTts.setLanguage(new Locale("es", "ES"));
            navigationTts.setAudioAttributes(attributes);
            navigationTts.setSpeechRate(1.0f);
            navigationTts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String utteranceId) { }
                @Override public void onDone(String utteranceId) { abandonNavigationAudioFocus(); }
                @Override public void onError(String utteranceId) { abandonNavigationAudioFocus(); }
            });
        });
    }

    private boolean speakNavigationInternal(String text, String utteranceId) {
        if (!navigationTtsReady || navigationTts == null || text == null || text.isBlank()) return false;
        if (audioManager != null && navigationAudioFocus != null) audioManager.requestAudioFocus(navigationAudioFocus);
        return navigationTts.speak(text, TextToSpeech.QUEUE_FLUSH, null,
                utteranceId == null || utteranceId.isBlank() ? "clarify-navigation" : utteranceId) == TextToSpeech.SUCCESS;
    }

    private void stopNavigationSpeechInternal() {
        if (navigationTts != null) navigationTts.stop();
        abandonNavigationAudioFocus();
    }

    private void abandonNavigationAudioFocus() {
        if (audioManager != null && navigationAudioFocus != null) audioManager.abandonAudioFocusRequest(navigationAudioFocus);
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void configureWebView() {
        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.addJavascriptInterface(new NativeBridge(), "ClarifyAndroid");
        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("/api/mapbox-token".equals(uri.getPath())) return jsonResponse("{\"token\":" + JSONObject.quote(BuildConfig.MAPBOX_PUBLIC_TOKEN) + "}", 200, "OK");
                if ("/api/fuel-stations".equals(uri.getPath())) {
                    try { return jsonResponse(loadFuelStations(), 200, "OK"); }
                    catch (Exception error) { return jsonResponse("{\"error\":\"Fuente de bencineras no disponible\"}", 502, "Bad Gateway"); }
                }
                return assetLoader.shouldInterceptRequest(uri);
            }
            @Override public void onPageFinished(WebView view, String url) {
                pageReady = true;
                sendBluetoothStatus("");
                notifyDriveStatus(isDriveSignedInInternal(), null, null);
                if (pendingAutoFinish || BluetoothPrefs.consumePendingFinish(MainActivity.this)) finishBluetoothTrip();
                else if (pendingAutoStart || BluetoothPrefs.consumePendingStart(MainActivity.this)) startFreeDrive();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                boolean granted = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                callback.invoke(origin, granted, false);
                if (!granted) permissionLauncher.launch(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION});
            }
            @Override public void onPermissionRequest(PermissionRequest request) { runOnUiThread(() -> request.grant(request.getResources())); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                openReceiptFileChooser(callback, params);
                return true;
            }
        });
        webView.loadUrl(APP_URL);
    }

    private void openReceiptFileChooser(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
        fileChooserCallback = callback;
        try {
            File photo = File.createTempFile("clarify-boleta-", ".jpg", getCacheDir());
            pendingCameraUri = FileProvider.getUriForFile(this, getPackageName() + ".files", photo);
            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                    .putExtra(MediaStore.EXTRA_OUTPUT, pendingCameraUri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            Intent picker = new Intent(Intent.ACTION_GET_CONTENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("image/*");
            Intent launch;
            if (params != null && params.isCaptureEnabled()) launch = camera;
            else {
                launch = Intent.createChooser(picker, "Seleccionar boleta");
                launch.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
            }
            fileChooserLauncher.launch(launch);
        } catch (Exception error) {
            fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = null;
            pendingCameraUri = null;
            Toast.makeText(this, "No pudimos abrir la cámara o galería", Toast.LENGTH_LONG).show();
        }
    }

    private WebResourceResponse jsonResponse(String body, int status, String reason) {
        WebResourceResponse response = new WebResourceResponse("application/json", "UTF-8", new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
        response.setStatusCodeAndReasonPhrase(status, reason);
        response.setResponseHeaders(java.util.Map.of("Cache-Control", "no-store", "Access-Control-Allow-Origin", "*"));
        return response;
    }

    private String loadFuelStations() throws Exception {
        JSONObject stationsPayload = readJson("https://api.bencinaenlinea.cl/api/busqueda_estacion_filtro");
        JSONObject brandsPayload = readJson("https://api.bencinaenlinea.cl/api/marca_ciudadano");
        JSONArray brandRows = brandsPayload.optJSONArray("data");
        JSONObject brands = new JSONObject();
        if (brandRows != null) for (int index = 0; index < brandRows.length(); index++) {
            JSONObject brand = brandRows.optJSONObject(index);
            if (brand != null) brands.put(String.valueOf(brand.opt("id")), new JSONObject().put("nombre", brand.optString("nombre", "Bencinera")));
        }
        return new JSONObject()
                .put("source", "Bencina en Línea · Comisión Nacional de Energía")
                .put("retrievedAt", java.time.Instant.now().toString())
                .put("stations", stationsPayload.optJSONArray("data") == null ? new JSONArray() : stationsPayload.optJSONArray("data"))
                .put("brands", brands).toString();
    }

    private JSONObject readJson(String address) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(10000); connection.setReadTimeout(15000); connection.setRequestProperty("Accept", "application/json");
        try {
            if (connection.getResponseCode() < 200 || connection.getResponseCode() >= 300) throw new IllegalStateException("HTTP " + connection.getResponseCode());
            BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder body = new StringBuilder(); String line;
            while ((line = reader.readLine()) != null) body.append(line);
            return new JSONObject(body.toString());
        } finally { connection.disconnect(); }
    }

    private void requestInitialPermissions() {
        List<String> permissions = new ArrayList<>();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) permissions.add(Manifest.permission.ACCESS_FINE_LOCATION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) permissions.add(Manifest.permission.BLUETOOTH_CONNECT);
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) permissions.add(Manifest.permission.POST_NOTIFICATIONS);
        if (!permissions.isEmpty()) permissionLauncher.launch(permissions.toArray(new String[0]));
    }

    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); handleIntent(intent); }
    private void handleIntent(Intent intent) {
        boolean finishRequested = BluetoothPrefs.consumePendingFinish(this), startRequested = BluetoothPrefs.consumePendingStart(this);
        if (finishRequested) {
            pendingAutoFinish = true;
            pendingAutoStart = false;
            if (pageReady) finishBluetoothTrip();
        } else if (startRequested && BluetoothPrefs.anyConnected(this)) {
            pendingAutoStart = true;
            if (pageReady) startFreeDrive();
        }
    }
    private void startFreeDrive() {
        pendingAutoStart = false;
        BluetoothPrefs.setPendingStart(this, false);
        webView.evaluateJavascript("window.ClarifyNativeBluetoothAutoStart&&window.ClarifyNativeBluetoothAutoStart()", null);
    }
    private void finishBluetoothTrip() {
        pendingAutoFinish = false;
        BluetoothPrefs.setPendingFinish(this, false);
        webView.evaluateJavascript("window.ClarifyNativeBluetoothAutoFinish&&window.ClarifyNativeBluetoothAutoFinish()", null);
    }

    private void showDevicePicker() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            permissionLauncher.launch(new String[]{Manifest.permission.BLUETOOTH_CONNECT});
            Toast.makeText(this, "Autoriza Dispositivos cercanos y vuelve a pulsar Vincular", Toast.LENGTH_LONG).show();
            return;
        }
        BluetoothManager manager = getSystemService(BluetoothManager.class);
        BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null) { Toast.makeText(this, "Este teléfono no tiene Bluetooth", Toast.LENGTH_LONG).show(); return; }
        if (!adapter.isEnabled()) { startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS)); return; }
        Set<BluetoothDevice> bonded = adapter.getBondedDevices();
        List<BluetoothDevice> devices = new ArrayList<>(bonded);
        devices.sort(Comparator.comparing(device -> safeName(device).toLowerCase()));
        if (devices.isEmpty()) { Toast.makeText(this, "Primero empareja el Bluetooth del auto en Ajustes", Toast.LENGTH_LONG).show(); startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS)); return; }
        String[] labels = devices.stream().map(device -> safeName(device) + "\n" + device.getAddress()).toArray(String[]::new);
        boolean[] checked = new boolean[devices.size()];
        for (int index = 0; index < devices.size(); index++) checked[index] = BluetoothPrefs.contains(this, devices.get(index).getAddress());
        new AlertDialog.Builder(this)
                .setTitle("Configurar Auto")
                .setMessage("Selecciona uno o más Bluetooth de tu vehículo. Cualquiera iniciará el viaje y, al desconectarse todos durante 30 segundos, Clarify lo finalizará.")
                .setMultiChoiceItems(labels, checked, (dialog, index, selected) -> checked[index] = selected)
                .setPositiveButton("Listo", (dialog, which) -> {
                    Set<String> selectedAddresses = new HashSet<>(); Map<String, String> names = new HashMap<>();
                    for (int index = 0; index < devices.size(); index++) if (checked[index]) {
                        BluetoothDevice selected = devices.get(index); selectedAddresses.add(selected.getAddress()); names.put(selected.getAddress(), safeName(selected));
                    }
                    BluetoothPrefs.saveSelection(this, selectedAddresses, names);
                    String count = selectedAddresses.size() == 1 ? "1 dispositivo vinculado" : selectedAddresses.size() + " dispositivos vinculados";
                    sendBluetoothStatus(selectedAddresses.isEmpty() ? "Sin dispositivo vinculado" : count + " · inicio y cierre automáticos activos");
                    Toast.makeText(this, selectedAddresses.isEmpty() ? "Auto inicio desactivado" : count, Toast.LENGTH_LONG).show();
                }).setNegativeButton("Cancelar", null).show();
    }

    private String safeName(BluetoothDevice device) {
        try { String value = device.getName(); return value == null || value.isBlank() ? "Dispositivo Bluetooth" : value; }
        catch (SecurityException ignored) { return "Dispositivo Bluetooth"; }
    }
    private void sendBluetoothStatus(String message) {
        if (!pageReady) return;
        try {
            JSONArray devices = new JSONArray();
            for (String address : BluetoothPrefs.addresses(this)) devices.put(new JSONObject().put("id", address).put("name", BluetoothPrefs.nameFor(this, address)).put("connected", BluetoothPrefs.connected(this).contains(address)));
            long remaining = Math.max(0L, BluetoothPrefs.disconnectDeadline(this) - System.currentTimeMillis());
            JSONObject payload = new JSONObject().put("deviceId", BluetoothPrefs.address(this)).put("deviceName", BluetoothPrefs.name(this)).put("devices", devices).put("connected", BluetoothPrefs.anyConnected(this)).put("enabled", BluetoothPrefs.enabled(this)).put("disconnectRemainingSeconds", (int)Math.ceil(remaining / 1000d)).put("message", message);
            webView.post(() -> webView.evaluateJavascript("window.ClarifyNativeBluetoothStatus&&window.ClarifyNativeBluetoothStatus(" + JSONObject.quote(payload.toString()) + ")", null));
        } catch (Exception ignored) { }
    }

    public final class NativeBridge {
        @JavascriptInterface public void selectCarBluetooth() { runOnUiThread(MainActivity.this::showDevicePicker); }
        @JavascriptInterface public void requestBluetoothStatus() { runOnUiThread(() -> sendBluetoothStatus("")); }
        @JavascriptInterface public void setBluetoothAutoStartEnabled(boolean enabled) { BluetoothPrefs.setEnabled(MainActivity.this, enabled); runOnUiThread(() -> sendBluetoothStatus(enabled ? "Inicio automático activo" : "Inicio automático desactivado")); }
        @JavascriptInterface public void forgetCarBluetooth() { BluetoothPrefs.forget(MainActivity.this); runOnUiThread(() -> sendBluetoothStatus("Sin dispositivo vinculado")); }
        @JavascriptInterface public void setNotificationsEnabled(boolean enabled) { getSharedPreferences("clarify_notifications", MODE_PRIVATE).edit().putBoolean("enabled", enabled).apply(); }
        @JavascriptInterface public void showNativeNotification(String title, String body, String tag) { runOnUiThread(() -> showNativeNotificationInternal(title, body, tag)); }
        @JavascriptInterface public void syncNavigationState(String json) { getSharedPreferences("clarify_car_state", MODE_PRIVATE).edit().putString("navigation_state", json == null ? "" : json).apply(); }
        @JavascriptInterface public void clearNavigationState() { getSharedPreferences("clarify_car_state", MODE_PRIVATE).edit().remove("navigation_state").apply(); }
        @JavascriptInterface public boolean speakNavigation(String text, String utteranceId) { return speakNavigationInternal(text, utteranceId); }
        @JavascriptInterface public void stopNavigationSpeech() { runOnUiThread(MainActivity.this::stopNavigationSpeechInternal); }
        @JavascriptInterface public boolean isNavigationSpeechAvailable() { return navigationTtsReady; }
        @JavascriptInterface public void driveSignIn() { runOnUiThread(() -> driveSignInLauncher.launch(googleSignInClient.getSignInIntent())); }
        @JavascriptInterface public boolean isDriveSignedIn() { return isDriveSignedInInternal(); }
        @JavascriptInterface public void driveSignOut() { runOnUiThread(() -> googleSignInClient.signOut().addOnCompleteListener(task -> notifyDriveStatus(false, null, null))); }
        @JavascriptInterface public void driveBackup(String jsonData) { new Thread(() -> performDriveBackup(jsonData)).start(); }
        @JavascriptInterface public void driveRestore() { new Thread(MainActivity.this::performDriveRestore).start(); }
    }

    private void showNativeNotificationInternal(String title, String body, String tag) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        String channelId = "clarify_navigation_alerts";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) manager.createNotificationChannel(new NotificationChannel(channelId, "Alertas de navegación", NotificationManager.IMPORTANCE_HIGH));
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(this, Math.abs(tag.hashCode()), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        manager.notify(Math.abs(tag.hashCode()), new NotificationCompat.Builder(this, channelId).setSmallIcon(R.drawable.ic_launcher).setContentTitle(title).setContentText(body).setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(true).setContentIntent(pending).build());
    }

    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        stopNavigationSpeechInternal();
        if (navigationTts != null) { navigationTts.shutdown(); navigationTts = null; }
        if (webView != null) { webView.removeJavascriptInterface("ClarifyAndroid"); webView.destroy(); }
        super.onDestroy();
    }
}
