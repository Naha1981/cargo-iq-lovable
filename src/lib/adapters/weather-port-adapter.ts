export interface PortWeather {
  time: string;
  windSpeed: number | null;
  windDirection: number | null;
  rain: number | null;
  waveHeight: number | null;
  waveDirection: number | null;
  wavePeriod: number | null;
  oceanCurrentSpeed: number | null;
  oceanCurrentDirection: number | null;
  source: string;
}

export async function fetchPortConditions(options: {
  latitude?: number;
  longitude?: number;
  start?: string;
  end?: string;
}) {
  const latitude = options.latitude ?? -29.8833;
  const longitude = options.longitude ?? 31.05;
  const marineUrl =
    "https://marine-api.open-meteo.com/v1/marine?latitude=" +
    latitude +
    "&longitude=" +
    longitude +
    "&hourly=wave_height,wave_direction,wave_period,ocean_current_velocity,ocean_current_direction&timezone=UTC";
  const response = await fetch(marineUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("OPEN_METEO_MARINE_" + response.status);
  type MarineResponse = {
    hourly?: {
      time?: string[];
      wave_height?: (number | null)[];
      wave_direction?: (number | null)[];
      wave_period?: (number | null)[];
      ocean_current_velocity?: (number | null)[];
      ocean_current_direction?: (number | null)[];
    };
  };
  const body = (await response.json()) as MarineResponse;
  const weatherUrl =
    "https://api.open-meteo.com/v1/forecast?latitude=" +
    latitude +
    "&longitude=" +
    longitude +
    "&hourly=wind_speed_10m,wind_direction_10m,rain&timezone=UTC";
  const weatherResponse = await fetch(weatherUrl, { cache: "no-store" });
  type ForecastResponse = {
    hourly?: {
      wind_speed_10m?: (number | null)[];
      wind_direction_10m?: (number | null)[];
      rain?: (number | null)[];
    };
  };
  const weather = weatherResponse.ok ? ((await weatherResponse.json()) as ForecastResponse) : null;
  const times = body?.hourly?.time ?? [];
  return times
    .map((time: string, i: number): PortWeather => ({
      time,
      windSpeed: weather?.hourly?.wind_speed_10m?.[i] ?? null,
      windDirection: weather?.hourly?.wind_direction_10m?.[i] ?? null,
      rain: weather?.hourly?.rain?.[i] ?? null,
      waveHeight: body?.hourly?.wave_height?.[i] ?? null,
      waveDirection: body?.hourly?.wave_direction?.[i] ?? null,
      wavePeriod: body?.hourly?.wave_period?.[i] ?? null,
      oceanCurrentSpeed: body?.hourly?.ocean_current_velocity?.[i] ?? null,
      oceanCurrentDirection: body?.hourly?.ocean_current_direction?.[i] ?? null,
      source: "Open-Meteo Marine",
    }))
    .filter((row: PortWeather) => {
      const t = Date.parse(row.time);
      return (
        (!options.start || t >= Date.parse(options.start)) &&
        (!options.end || t <= Date.parse(options.end))
      );
    });
}
