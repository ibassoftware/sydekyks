import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

const weatherCodeLabels: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  80: 'Light showers',
  81: 'Showers',
  82: 'Heavy showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Severe thunderstorm with hail'
}

const geocodingSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        country: z.string().optional(),
        admin1: z.string().optional(),
        latitude: z.number(),
        longitude: z.number()
      })
    )
    .optional()
})

const forecastSchema = z.object({
  current: z.object({
    temperature_2m: z.number(),
    apparent_temperature: z.number(),
    relative_humidity_2m: z.number(),
    weather_code: z.number(),
    wind_speed_10m: z.number()
  }),
  current_units: z.object({
    temperature_2m: z.string(),
    wind_speed_10m: z.string()
  })
})

export const weatherTool = createTool({
  id: 'get-weather',
  description: 'Get the current weather for a city or place',
  inputSchema: z.object({
    location: z.string().min(2).describe('City or place name')
  }),
  outputSchema: z.object({
    location: z.string(),
    condition: z.string(),
    temperature: z.number(),
    apparentTemperature: z.number(),
    humidity: z.number(),
    windSpeed: z.number(),
    temperatureUnit: z.string(),
    windSpeedUnit: z.string()
  }),
  execute: async ({ location }) => {
    const geocodingUrl = new URL('https://geocoding-api.open-meteo.com/v1/search')
    geocodingUrl.searchParams.set('name', location)
    geocodingUrl.searchParams.set('count', '1')
    geocodingUrl.searchParams.set('language', 'en')
    geocodingUrl.searchParams.set('format', 'json')

    const geocodingResponse = await fetch(geocodingUrl)
    if (!geocodingResponse.ok) throw new Error('Could not look up that location')

    const geocoding = geocodingSchema.parse(await geocodingResponse.json())
    const place = geocoding.results?.[0]
    if (!place) throw new Error(`No location found for "${location}"`)

    const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast')
    forecastUrl.searchParams.set('latitude', String(place.latitude))
    forecastUrl.searchParams.set('longitude', String(place.longitude))
    forecastUrl.searchParams.set(
      'current',
      'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m'
    )
    forecastUrl.searchParams.set('timezone', 'auto')

    const forecastResponse = await fetch(forecastUrl)
    if (!forecastResponse.ok) throw new Error('Could not retrieve the current weather')

    const forecast = forecastSchema.parse(await forecastResponse.json())
    const displayLocation = [place.name, place.admin1, place.country].filter(Boolean).join(', ')

    return {
      location: displayLocation,
      condition: weatherCodeLabels[forecast.current.weather_code] ?? 'Unknown conditions',
      temperature: forecast.current.temperature_2m,
      apparentTemperature: forecast.current.apparent_temperature,
      humidity: forecast.current.relative_humidity_2m,
      windSpeed: forecast.current.wind_speed_10m,
      temperatureUnit: forecast.current_units.temperature_2m,
      windSpeedUnit: forecast.current_units.wind_speed_10m
    }
  }
})
