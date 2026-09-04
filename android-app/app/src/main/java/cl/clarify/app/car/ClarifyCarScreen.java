package cl.clarify.app.car;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.CarToast;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ActionStrip;
import androidx.car.app.model.CarColor;
import androidx.car.app.model.Distance;
import androidx.car.app.model.Template;
import androidx.car.app.navigation.model.MessageInfo;
import androidx.car.app.navigation.model.NavigationTemplate;
import androidx.car.app.navigation.model.RoutingInfo;
import androidx.car.app.navigation.model.Step;
import androidx.car.app.navigation.model.TravelEstimate;

import java.time.ZonedDateTime;

final class ClarifyCarScreen extends Screen {
    private final ClarifyCarSurfaceRenderer renderer;
    private CarNavigationState state = CarNavigationState.empty();

    ClarifyCarScreen(@NonNull CarContext context, @NonNull ClarifyCarSurfaceRenderer renderer) {
        super(context);
        this.renderer = renderer;
    }

    void updateState(@NonNull CarNavigationState next) {
        state = next;
        invalidate();
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        NavigationTemplate.Builder builder = new NavigationTemplate.Builder()
                .setBackgroundColor(CarColor.SECONDARY)
                .setActionStrip(new ActionStrip.Builder()
                        .addAction(new Action.Builder().setTitle("Centrar")
                                .setOnClickListener(renderer::recenter).build())
                        .addAction(new Action.Builder().setTitle("Estado")
                                .setOnClickListener(() -> CarToast.makeText(getCarContext(),
                                        state.hasLocation() ? "GPS activo" : "Esperando GPS",
                                        CarToast.LENGTH_SHORT).show()).build())
                        .build());

        if (state.active && !state.freeDrive) {
            double stepMeters = parseDistanceMeters(state.instructionDistance);
            Step step = new Step.Builder(state.instruction.isBlank() ? "Continúa por la ruta" : state.instruction)
                    .setRoad(state.road.isBlank() ? state.destinationName : state.road)
                    .build();
            builder.setNavigationInfo(new RoutingInfo.Builder()
                    .setCurrentStep(step, Distance.create(Math.max(1, stepMeters), Distance.UNIT_METERS))
                    .build());
            long seconds = parseRemainingSeconds(state.remainingTime);
            builder.setDestinationTravelEstimate(new TravelEstimate.Builder(
                    Distance.create(Math.max(1, state.remainingMeters), Distance.UNIT_METERS),
                    ZonedDateTime.now().plusSeconds(Math.max(1, seconds)))
                    .setRemainingTimeSeconds(Math.max(1, seconds))
                    .build());
        } else {
            String message = state.hasLocation()
                    ? String.format(java.util.Locale.US, "Conducción libre · %.0f km/h", state.speedKph)
                    : "Abre Clarify en el teléfono y concede ubicación";
            builder.setNavigationInfo(new MessageInfo.Builder(message).build());
        }
        return builder.build();
    }

    private static double parseDistanceMeters(String text) {
        if (text == null) return 100;
        try {
            String normalized = text.toLowerCase(java.util.Locale.ROOT).replace(',', '.');
            String number = normalized.replaceAll("[^0-9.]", "");
            double value = number.isBlank() ? 100 : Double.parseDouble(number);
            return normalized.contains("km") ? value * 1000 : value;
        } catch (Exception ignored) { return 100; }
    }

    private static long parseRemainingSeconds(String text) {
        if (text == null || text.isBlank()) return 60;
        try {
            String[] parts = text.split(":");
            if (parts.length == 2) return Long.parseLong(parts[0]) * 60 + Long.parseLong(parts[1]);
            String digits = text.replaceAll("[^0-9]", "");
            return digits.isBlank() ? 60 : Long.parseLong(digits) * 60;
        } catch (Exception ignored) { return 60; }
    }
}
