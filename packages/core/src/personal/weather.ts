import { Context, Effect, Layer } from "effect"

export interface CurrentWeather {
  temperature: number
  feelsLike: number
  humidity: number
  windSpeed: number
  weatherCode: number
  weatherDescription: string
}

export interface ForecastDay {
  date: string
  tempMax: number
  tempMin: number
  weatherCode: number
  weatherDescription: string
}

export interface Interface {
  readonly getCurrent: (
    latitude?: number,
    longitude?: number,
    city?: string,
  ) => Effect.Effect<CurrentWeather>
  readonly getForecast: (
    latitude?: number,
    longitude?: number,
    days?: number,
  ) => Effect.Effect<ForecastDay[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Weather") {}

const weatherCodes: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
}

function describeWeather(code: number): string {
  return weatherCodes[code] ?? "Unknown"
}

export const layer = Layer.effect(Service, Effect.gen(function* () {
  return Service.of({
    getCurrent: (latitude, longitude, _city) =>
      Effect.gen(function* () {
        const lat = latitude ?? 40.7128
        const lon = longitude ?? -74.006
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`
        const res = yield* Effect.tryPromise(() => fetch(url).then((r) => r.json()))
        const data = res as any
        return {
          temperature: data.current.temperature_2m,
          feelsLike: data.current.apparent_temperature,
          humidity: data.current.relative_humidity_2m,
          windSpeed: data.current.wind_speed_10m,
          weatherCode: data.current.weather_code,
          weatherDescription: describeWeather(data.current.weather_code),
        }
      }),
    getForecast: (latitude, longitude, days) =>
      Effect.gen(function* () {
        const lat = latitude ?? 40.7128
        const lon = longitude ?? -74.006
        const nDays = days ?? 7
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=${nDays}`
        const res = yield* Effect.tryPromise(() => fetch(url).then((r) => r.json()))
        const data = res as any
        return data.daily.time.map((date: string, i: number) => ({
          date,
          tempMax: data.daily.temperature_2m_max[i],
          tempMin: data.daily.temperature_2m_min[i],
          weatherCode: data.daily.weather_code[i],
          weatherDescription: describeWeather(data.daily.weather_code[i]),
        }))
      }),
  })
}))

export const defaultLayer = layer

export { Service as Weather }
