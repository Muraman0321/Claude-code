export interface FlightSummary {
  id: number;
  filename: string;
  pilot: string;
  aircraft: string;
  remarks: string | null;
  flight_date: string;
  started_at: string | null;
  ended_at: string | null;
  duration_s: number | null;
  total_distance_km: number | null;
  straight_distance_km: number | null;
  max_altitude_m: number | null;
  altitude_gain_m: number | null;
  max_climb_rate_ms: number | null;
  avg_climb_in_thermals_ms: number | null;
  avg_ground_speed_kmh: number | null;
  max_ground_speed_kmh: number | null;
  best_glide_ratio: number | null;
  thermal_count: number | null;
  thermal_time_s: number | null;
  cruise_time_s: number | null;
}

export interface Fix {
  seq: number;
  timestamp: string;
  latitude: number;
  longitude: number;
  altitude_m: number;
  ground_speed_kmh: number | null;
  climb_rate_ms: number | null;
}

export interface Thermal {
  start_time: string;
  end_time: string;
  duration_s: number;
  altitude_gain_m: number;
  avg_climb_rate_ms: number;
  center_lat: number;
  center_lon: number;
}

export interface FlightDetail extends FlightSummary {
  fixes: Fix[];
  thermals: Thermal[];
}

export interface UploadResult {
  filename: string;
  success: boolean;
  flight_id: number | null;
  error: string | null;
}

export interface PilotStats {
  pilot: string;
  flight_count: number;
  total_hours: number;
  avg_climb_in_thermals_ms: number | null;
  avg_ground_speed_kmh: number | null;
  best_glide_ratio: number | null;
  total_distance_km: number;
}

export interface AircraftStats {
  aircraft: string;
  flight_count: number;
  avg_climb_in_thermals_ms: number | null;
  avg_ground_speed_kmh: number | null;
  best_glide_ratio: number | null;
}
