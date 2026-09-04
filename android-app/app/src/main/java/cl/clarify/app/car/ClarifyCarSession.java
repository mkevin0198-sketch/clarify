package cl.clarify.app.car;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.car.app.Screen;
import androidx.car.app.Session;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;

final class ClarifyCarSession extends Session implements DefaultLifecycleObserver {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final LocationListener locationListener = this::onLocation;
    private CarNavigationState state = CarNavigationState.empty();
    private ClarifyCarSurfaceRenderer renderer;
    private ClarifyCarScreen screen;
    private LocationManager locationManager;

    private final Runnable statePoll = new Runnable() {
        @Override public void run() {
            SharedPreferences preferences = getCarContext().getSharedPreferences("clarify_car_state", Context.MODE_PRIVATE);
            CarNavigationState next = CarNavigationState.fromJson(preferences.getString("navigation_state", ""), state);
            if (state.hasLocation() && !next.hasLocation()) next = next.withGps(state.longitude, state.latitude, state.heading, state.speedKph);
            state = next;
            if (renderer != null) renderer.updateState(state);
            if (screen != null) screen.updateState(state);
            handler.postDelayed(this, 1000);
        }
    };

    ClarifyCarSession() {
        getLifecycle().addObserver(this);
    }

    @NonNull
    @Override
    public Screen onCreateScreen(@NonNull Intent intent) {
        renderer = new ClarifyCarSurfaceRenderer(getCarContext(), getLifecycle());
        screen = new ClarifyCarScreen(getCarContext(), renderer);
        screen.updateState(state);
        return screen;
    }

    @Override public void onStart(@NonNull LifecycleOwner owner) {
        handler.removeCallbacks(statePoll);
        handler.post(statePoll);
        startLocationUpdates();
    }

    @Override public void onStop(@NonNull LifecycleOwner owner) {
        handler.removeCallbacks(statePoll);
        if (locationManager != null) locationManager.removeUpdates(locationListener);
    }

    @SuppressLint("MissingPermission")
    private void startLocationUpdates() {
        if (getCarContext().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && getCarContext().checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return;
        locationManager = (LocationManager) getCarContext().getSystemService(Context.LOCATION_SERVICE);
        Location last = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
        if (last != null) onLocation(last);
        locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 750, 1, locationListener, Looper.getMainLooper());
    }

    private void onLocation(@NonNull Location location) {
        float heading = location.hasBearing() && location.getSpeed() > 0.8f ? location.getBearing() : state.heading;
        float speed = location.hasSpeed() ? Math.max(0, location.getSpeed() * 3.6f) : state.speedKph;
        state = state.withGps(location.getLongitude(), location.getLatitude(), heading, speed);
        if (renderer != null) renderer.updateState(state);
        if (screen != null) screen.updateState(state);
    }

    @Override public void onCarConfigurationChanged(@NonNull android.content.res.Configuration configuration) {
        if (renderer != null) renderer.renderFrame();
    }
}
