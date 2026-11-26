/**
 * LiveTrackingMap – Leaflet / OpenStreetMap based real-time tracking.
 *
 * Shows the user's location and the mechanic's live-updating location
 * on a free OpenStreetMap tile layer, with a straight polyline drawn
 * between them, a live distance indicator, and a "Live Tracking" badge.
 *
 * Props:
 *   userLocation      – { lat, lng } of the breakdown user
 *   providerLocation  – { lat, lng } of the mechanic (updates via socket)
 *   providerName      – display name for the mechanic marker
 *   status            – current request status string
 *   onEtaUpdate       – callback(seconds) when ETA recalculates (approx)
 */
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet's default icon paths when bundled with Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const DEFAULT_CENTER = [20.5937, 78.9629]; // India centre

/** Haversine distance in km between two {lat,lng} points */
function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const c =
    sinDLat * sinDLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinDLng * sinDLng;
  return R * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

export default function LiveTrackingMap({
  userLocation,
  providerLocation,
  providerName = "Mechanic",
  status,
  onEtaUpdate,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const providerMarkerRef = useRef(null);
  const polylineRef = useRef(null);

  // Initialise map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const center = userLocation
      ? [userLocation.lat, userLocation.lng]
      : providerLocation
      ? [providerLocation.lat, providerLocation.lng]
      : DEFAULT_CENTER;

    const map = L.map(containerRef.current, {
      center,
      zoom: 14,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    mapRef.current = map;

    // Force Leaflet to recalculate container bounds after modal animation completes
    const t1 = setTimeout(() => map.invalidateSize(), 150);
    const t2 = setTimeout(() => map.invalidateSize(), 500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      map.remove();
      mapRef.current = null;
      userMarkerRef.current = null;
      providerMarkerRef.current = null;
      polylineRef.current = null;
    };
  }, []);

  // Update markers, polyline and view bounds whenever coordinates change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    map.invalidateSize();

    // ── 1. User Marker ──
    const hasUser =
      userLocation &&
      typeof userLocation.lat === "number" &&
      typeof userLocation.lng === "number";

    if (hasUser) {
      const uLatLng = [userLocation.lat, userLocation.lng];
      const userIcon = L.divIcon({
        className: "",
        html: `<div style="
          width:22px;height:22px;border-radius:50%;
          background:#3B82F6;border:3px solid #fff;
          box-shadow:0 0 6px rgba(0,0,0,0.5);
          display:flex;align-items:center;justify-content:center;
          font-size:8px;font-weight:bold;color:#fff;">
          You
        </div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });

      if (userMarkerRef.current) {
        userMarkerRef.current.setLatLng(uLatLng);
      } else {
        userMarkerRef.current = L.marker(uLatLng, { icon: userIcon })
          .addTo(map)
          .bindPopup("Your location");
      }
    }

    // ── 2. Provider Marker ──
    const hasProvider =
      providerLocation &&
      typeof providerLocation.lat === "number" &&
      typeof providerLocation.lng === "number";

    if (hasProvider) {
      const pLatLng = [providerLocation.lat, providerLocation.lng];
      const initials = (providerName || "Mechanic").slice(0, 2).toUpperCase();
      const providerIcon = L.divIcon({
        className: "",
        html: `<div style="
          width:28px;height:28px;border-radius:50%;
          background:#F59E0B;border:2px solid #FDE68A;
          box-shadow:0 0 6px rgba(0,0,0,0.5);
          display:flex;align-items:center;justify-content:center;
          font-size:10px;font-weight:bold;color:#0f172a;">
          ${initials}
        </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      if (providerMarkerRef.current) {
        providerMarkerRef.current.setLatLng(pLatLng);
        providerMarkerRef.current.getPopup()?.setContent(providerName);
      } else {
        providerMarkerRef.current = L.marker(pLatLng, { icon: providerIcon })
          .addTo(map)
          .bindPopup(providerName);
      }
    }

    // ── 3. Polyline & Auto-Fit View ──
    if (hasUser && hasProvider) {
      const points = [
        [userLocation.lat, userLocation.lng],
        [providerLocation.lat, providerLocation.lng],
      ];

      if (polylineRef.current) {
        polylineRef.current.setLatLngs(points);
      } else {
        polylineRef.current = L.polyline(points, {
          color: "#F59E0B",
          weight: 4,
          opacity: 0.85,
          dashArray: "8 6",
        }).addTo(map);
      }

      map.fitBounds(L.latLngBounds(points), {
        padding: [60, 60],
        maxZoom: 16,
      });

      const dist = haversineKm(userLocation, providerLocation);
      const eta = Math.round((dist / 30) * 3600);
      if (onEtaUpdate) onEtaUpdate(eta);
    } else if (hasUser) {
      map.setView([userLocation.lat, userLocation.lng], 14);
    } else if (hasProvider) {
      map.setView([providerLocation.lat, providerLocation.lng], 14);
    }
  }, [userLocation, providerLocation, providerName, onEtaUpdate]);

  // Distance calculation
  const distKm =
    userLocation &&
    providerLocation &&
    typeof userLocation.lat === "number" &&
    typeof providerLocation.lat === "number"
      ? haversineKm(userLocation, providerLocation).toFixed(1)
      : null;
  const etaMin = distKm ? Math.round((distKm / 30) * 60) : null;

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden">
      {/* Leaflet map container */}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* ETA + Distance overlay */}
      {distKm && (
        <div className="absolute top-4 left-4 z-[1000] bg-slate-900/90 backdrop-blur-md border border-white/10 rounded-xl px-4 py-2.5 flex items-center gap-4">
          <div>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider">
              ETA
            </p>
            <p className="text-amber-400 font-bold text-sm">~{etaMin} min</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider">
              Distance
            </p>
            <p className="text-white font-bold text-sm">{distKm} km</p>
          </div>
        </div>
      )}

      {/* Live tracking badge */}
      <div className="absolute bottom-4 left-4 z-[1000] bg-slate-900/90 backdrop-blur-md border border-white/10 rounded-lg px-3 py-1.5">
        <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Live Tracking
        </span>
      </div>
    </div>
  );
}
