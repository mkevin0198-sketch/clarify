package cl.clarify.app.car;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class CarNavigationState {
    final boolean active;
    final boolean freeDrive;
    final long updatedAt;
    final String destinationName;
    final double longitude;
    final double latitude;
    final float heading;
    final float speedKph;
    final int speedLimitKph;
    final String instruction;
    final String instructionDistance;
    final String road;
    final double remainingMeters;
    final String remainingTime;
    final String eta;
    final List<double[]> routeCoords;

    private CarNavigationState(boolean active, boolean freeDrive, long updatedAt,
            String destinationName, double longitude, double latitude, float heading,
            float speedKph, int speedLimitKph, String instruction, String instructionDistance,
            String road, double remainingMeters, String remainingTime, String eta,
            List<double[]> routeCoords) {
        this.active = active;
        this.freeDrive = freeDrive;
        this.updatedAt = updatedAt;
        this.destinationName = destinationName;
        this.longitude = longitude;
        this.latitude = latitude;
        this.heading = heading;
        this.speedKph = speedKph;
        this.speedLimitKph = speedLimitKph;
        this.instruction = instruction;
        this.instructionDistance = instructionDistance;
        this.road = road;
        this.remainingMeters = remainingMeters;
        this.remainingTime = remainingTime;
        this.eta = eta;
        this.routeCoords = routeCoords;
    }

    static CarNavigationState empty() {
        return new CarNavigationState(false, true, 0, "Sin destino", Double.NaN, Double.NaN,
                0, 0, 0, "Conducción libre", "", "GPS listo", 0, "", "",
                Collections.emptyList());
    }

    static CarNavigationState fromJson(String json, CarNavigationState fallback) {
        if (json == null || json.isBlank()) return fallback;
        try {
            JSONObject value = new JSONObject(json);
            JSONArray position = value.optJSONArray("position");
            double longitude = position != null ? position.optDouble(0, fallback.longitude) : fallback.longitude;
            double latitude = position != null ? position.optDouble(1, fallback.latitude) : fallback.latitude;
            List<double[]> route = new ArrayList<>();
            JSONArray points = value.optJSONArray("routeCoords");
            if (points != null) {
                for (int i = 0; i < points.length(); i++) {
                    JSONArray point = points.optJSONArray(i);
                    if (point != null && point.length() >= 2) {
                        double lng = point.optDouble(0, Double.NaN);
                        double lat = point.optDouble(1, Double.NaN);
                        if (Double.isFinite(lng) && Double.isFinite(lat)) route.add(new double[]{lng, lat});
                    }
                }
            }
            return new CarNavigationState(
                    value.optBoolean("active", false), value.optBoolean("freeDrive", false),
                    value.optLong("updatedAt", 0), value.optString("destinationName", "Sin destino"),
                    longitude, latitude, (float) value.optDouble("heading", fallback.heading),
                    (float) value.optDouble("speedKph", fallback.speedKph),
                    value.optInt("speedLimitKph", 0), value.optString("instruction", "Continúa"),
                    value.optString("instructionDistance", ""), value.optString("road", ""),
                    value.optDouble("remainingMeters", 0), value.optString("remainingTime", ""),
                    value.optString("eta", ""), Collections.unmodifiableList(route));
        } catch (Exception ignored) {
            return fallback;
        }
    }

    CarNavigationState withGps(double longitude, double latitude, float heading, float speedKph) {
        return new CarNavigationState(active, freeDrive, updatedAt, destinationName, longitude,
                latitude, heading, speedKph, speedLimitKph, instruction, instructionDistance,
                road, remainingMeters, remainingTime, eta, routeCoords);
    }

    boolean hasLocation() {
        return Double.isFinite(longitude) && Double.isFinite(latitude);
    }
}
