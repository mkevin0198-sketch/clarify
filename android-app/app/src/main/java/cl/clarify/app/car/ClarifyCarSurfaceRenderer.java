package cl.clarify.app.car;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.view.Surface;

import androidx.annotation.MainThread;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.car.app.AppManager;
import androidx.car.app.CarContext;
import androidx.car.app.SurfaceCallback;
import androidx.car.app.SurfaceContainer;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.Lifecycle;
import androidx.lifecycle.LifecycleOwner;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import cl.clarify.app.BuildConfig;

final class ClarifyCarSurfaceRenderer implements DefaultLifecycleObserver {
    private static final double ZOOM = 15.2;
    private static final int STATIC_WIDTH = 800;
    private static final int STATIC_HEIGHT = 480;
    private static final long MAP_REFRESH_MS = 12000;
    private final CarContext context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Paint routeOutline = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint routePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint badgePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint arrowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private volatile CarNavigationState state = CarNavigationState.empty();
    private volatile Bitmap mapBitmap;
    private volatile double mapCenterLng = Double.NaN;
    private volatile double mapCenterLat = Double.NaN;
    private volatile long mapFetchedAt;
    private volatile boolean fetching;
    @Nullable private Surface surface;
    @Nullable private Rect visibleArea;

    private final SurfaceCallback callback = new SurfaceCallback() {
        @Override public void onSurfaceAvailable(@NonNull SurfaceContainer container) {
            synchronized (ClarifyCarSurfaceRenderer.this) {
                if (surface != null) surface.release();
                surface = container.getSurface();
            }
            maybeFetchMap(true);
            renderFrame();
        }
        @Override public void onSurfaceDestroyed(@NonNull SurfaceContainer container) {
            synchronized (ClarifyCarSurfaceRenderer.this) {
                if (surface != null) surface.release();
                surface = null;
            }
        }
        @Override public void onVisibleAreaChanged(@NonNull Rect area) { visibleArea = new Rect(area); renderFrame(); }
        @Override public void onStableAreaChanged(@NonNull Rect area) { renderFrame(); }
    };

    ClarifyCarSurfaceRenderer(@NonNull CarContext context, @NonNull Lifecycle lifecycle) {
        this.context = context;
        routeOutline.setColor(Color.WHITE);
        routeOutline.setStyle(Paint.Style.STROKE);
        routeOutline.setStrokeWidth(14);
        routeOutline.setStrokeCap(Paint.Cap.ROUND);
        routeOutline.setStrokeJoin(Paint.Join.ROUND);
        routePaint.setColor(Color.rgb(24, 102, 224));
        routePaint.setStyle(Paint.Style.STROKE);
        routePaint.setStrokeWidth(9);
        routePaint.setStrokeCap(Paint.Cap.ROUND);
        routePaint.setStrokeJoin(Paint.Join.ROUND);
        textPaint.setColor(Color.WHITE);
        textPaint.setTextSize(24);
        textPaint.setFakeBoldText(true);
        badgePaint.setColor(Color.rgb(5, 50, 42));
        arrowPaint.setColor(Color.rgb(7, 77, 64));
        arrowPaint.setStyle(Paint.Style.FILL);
        lifecycle.addObserver(this);
    }

    @Override public void onCreate(@NonNull LifecycleOwner owner) {
        context.getCarService(AppManager.class).setSurfaceCallback(callback);
    }

    @Override public void onDestroy(@NonNull LifecycleOwner owner) {
        network.shutdownNow();
        Bitmap old = mapBitmap;
        mapBitmap = null;
        if (old != null) old.recycle();
    }

    void updateState(@NonNull CarNavigationState next) {
        state = next;
        maybeFetchMap(false);
        renderFrame();
    }

    void recenter() {
        mapFetchedAt = 0;
        maybeFetchMap(true);
        renderFrame();
    }

    void renderFrame() {
        main.removeCallbacks(this::drawFrame);
        main.post(this::drawFrame);
    }

    private void maybeFetchMap(boolean force) {
        CarNavigationState snapshot = state;
        if (!snapshot.hasLocation() || fetching) return;
        double moved = distanceMeters(mapCenterLat, mapCenterLng, snapshot.latitude, snapshot.longitude);
        if (!force && mapBitmap != null && moved < 90 && System.currentTimeMillis() - mapFetchedAt < MAP_REFRESH_MS) return;
        fetching = true;
        final double lng = snapshot.longitude;
        final double lat = snapshot.latitude;
        final boolean dark = context.isDarkMode();
        network.execute(() -> {
            Bitmap downloaded = downloadMap(lng, lat, dark);
            main.post(() -> {
                fetching = false;
                if (downloaded != null) {
                    Bitmap old = mapBitmap;
                    mapBitmap = downloaded;
                    mapCenterLng = lng;
                    mapCenterLat = lat;
                    mapFetchedAt = System.currentTimeMillis();
                    if (old != null && old != downloaded) old.recycle();
                    drawFrame();
                }
            });
        });
    }

    @Nullable
    private Bitmap downloadMap(double lng, double lat, boolean dark) {
        HttpURLConnection connection = null;
        try {
            String style = dark ? "navigation-night-v1" : "navigation-day-v1";
            String token = URLEncoder.encode(BuildConfig.MAPBOX_PUBLIC_TOKEN, StandardCharsets.UTF_8.name());
            String url = String.format(Locale.US,
                    "https://api.mapbox.com/styles/v1/mapbox/%s/static/%.6f,%.6f,%.1f,0,0/%dx%d?logo=false&attribution=false&access_token=%s",
                    style, lng, lat, ZOOM, STATIC_WIDTH, STATIC_HEIGHT, token);
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(7000);
            connection.setReadTimeout(9000);
            connection.setRequestProperty("User-Agent", "Clarify-AndroidAuto/1.1");
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) return null;
            try (InputStream stream = connection.getInputStream()) {
                return BitmapFactory.decodeStream(stream);
            }
        } catch (Exception ignored) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    @MainThread
    private void drawFrame() {
        Surface target;
        synchronized (this) { target = surface; }
        if (target == null || !target.isValid()) return;
        Canvas canvas = null;
        try {
            canvas = target.lockCanvas(null);
            Bitmap bitmap = mapBitmap;
            if (bitmap != null && !bitmap.isRecycled()) {
                canvas.drawBitmap(bitmap, null, new Rect(0, 0, canvas.getWidth(), canvas.getHeight()), null);
            } else {
                drawFallback(canvas);
            }
            drawRoute(canvas);
            drawVehicle(canvas);
            drawStatus(canvas);
        } catch (Exception ignored) {
        } finally {
            if (canvas != null) try { target.unlockCanvasAndPost(canvas); } catch (Exception ignored) { }
        }
    }

    private void drawFallback(Canvas canvas) {
        canvas.drawColor(context.isDarkMode() ? Color.rgb(18, 32, 38) : Color.rgb(229, 236, 233));
        Paint roads = new Paint(Paint.ANTI_ALIAS_FLAG);
        roads.setColor(context.isDarkMode() ? Color.rgb(62, 79, 84) : Color.WHITE);
        roads.setStrokeWidth(7);
        int gap = Math.max(80, canvas.getWidth() / 8);
        for (int x = -canvas.getHeight(); x < canvas.getWidth() + canvas.getHeight(); x += gap) {
            canvas.drawLine(x, 0, x + canvas.getHeight(), canvas.getHeight(), roads);
            canvas.drawLine(x, canvas.getHeight(), x + canvas.getHeight(), 0, roads);
        }
    }

    private void drawRoute(Canvas canvas) {
        CarNavigationState snapshot = state;
        if (snapshot.routeCoords.size() < 2 || !Double.isFinite(mapCenterLng)) return;
        Path path = new Path();
        boolean first = true;
        for (double[] point : snapshot.routeCoords) {
            float[] pixel = project(point[0], point[1], canvas.getWidth(), canvas.getHeight());
            if (first) { path.moveTo(pixel[0], pixel[1]); first = false; }
            else path.lineTo(pixel[0], pixel[1]);
        }
        canvas.drawPath(path, routeOutline);
        canvas.drawPath(path, routePaint);
    }

    private void drawVehicle(Canvas canvas) {
        CarNavigationState snapshot = state;
        if (!snapshot.hasLocation()) return;
        float[] p = project(snapshot.longitude, snapshot.latitude, canvas.getWidth(), canvas.getHeight());
        canvas.save();
        canvas.rotate(snapshot.heading, p[0], p[1]);
        Path arrow = new Path();
        arrow.moveTo(p[0], p[1] - 31);
        arrow.lineTo(p[0] + 23, p[1] + 24);
        arrow.lineTo(p[0], p[1] + 15);
        arrow.lineTo(p[0] - 23, p[1] + 24);
        arrow.close();
        Paint halo = new Paint(Paint.ANTI_ALIAS_FLAG);
        halo.setColor(Color.WHITE);
        halo.setStyle(Paint.Style.STROKE);
        halo.setStrokeWidth(8);
        canvas.drawPath(arrow, halo);
        canvas.drawPath(arrow, arrowPaint);
        canvas.restore();
    }

    private void drawStatus(Canvas canvas) {
        Rect area = visibleArea;
        int left = area != null && !area.isEmpty() ? area.left + 18 : 18;
        int bottom = area != null && !area.isEmpty() ? area.bottom - 18 : canvas.getHeight() - 18;
        String speed = String.format(Locale.US, "%.0f km/h", state.speedKph);
        float width = textPaint.measureText(speed) + 36;
        canvas.drawRoundRect(left, bottom - 54, left + width, bottom, 22, 22, badgePaint);
        canvas.drawText(speed, left + 18, bottom - 17, textPaint);
        if (state.speedLimitKph > 0) {
            float centerX = left + width + 46;
            float centerY = bottom - 27;
            Paint sign = new Paint(Paint.ANTI_ALIAS_FLAG);
            sign.setColor(Color.WHITE);
            canvas.drawCircle(centerX, centerY, 31, sign);
            sign.setStyle(Paint.Style.STROKE);
            sign.setStrokeWidth(7);
            sign.setColor(Color.rgb(224, 52, 52));
            canvas.drawCircle(centerX, centerY, 27, sign);
            Paint limitText = new Paint(Paint.ANTI_ALIAS_FLAG);
            limitText.setColor(Color.rgb(30, 34, 36));
            limitText.setTextSize(23);
            limitText.setFakeBoldText(true);
            limitText.setTextAlign(Paint.Align.CENTER);
            canvas.drawText(String.valueOf(state.speedLimitKph), centerX, centerY + 8, limitText);
        }
        Paint attribution = new Paint(Paint.ANTI_ALIAS_FLAG);
        attribution.setColor(Color.WHITE);
        attribution.setTextSize(14);
        attribution.setShadowLayer(3, 0, 1, Color.BLACK);
        canvas.drawText("© Mapbox © OpenStreetMap", left, bottom - 67, attribution);
    }

    private float[] project(double longitude, double latitude, int width, int height) {
        double world = 256.0 * Math.pow(2, ZOOM);
        double centerX = (mapCenterLng + 180.0) / 360.0 * world;
        double sinCenter = Math.sin(Math.toRadians(Math.max(-85.0511, Math.min(85.0511, mapCenterLat))));
        double centerY = (0.5 - Math.log((1 + sinCenter) / (1 - sinCenter)) / (4 * Math.PI)) * world;
        double x = (longitude + 180.0) / 360.0 * world;
        double sin = Math.sin(Math.toRadians(Math.max(-85.0511, Math.min(85.0511, latitude))));
        double y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world;
        return new float[]{(float) (width / 2.0 + (x - centerX) * width / STATIC_WIDTH),
                (float) (height / 2.0 + (y - centerY) * height / STATIC_HEIGHT)};
    }

    private static double distanceMeters(double lat1, double lng1, double lat2, double lng2) {
        if (!Double.isFinite(lat1) || !Double.isFinite(lng1)) return Double.POSITIVE_INFINITY;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}
