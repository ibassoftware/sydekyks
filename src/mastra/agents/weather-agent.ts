import { Agent } from '@mastra/core/agent'
import { dynamicSydekyksModel } from '../lib/model'
import { weatherTool } from '../tools/weather-tool'

export const weatherAgent = new Agent({
  id: 'weather-agent',
  name: 'Weather Agent',
  instructions: `
    You are a concise, friendly weather assistant inside an Electron desktop app.
    Use the weather tool whenever the user asks about current weather.
    Ask for a location when none is supplied.
    Include the condition, temperature, feels-like temperature, humidity, and wind speed.
    Never invent weather data.
  `,
  model: dynamicSydekyksModel,
  tools: { weatherTool }
})
