import { aiRuntime } from './ai-runtime'

export const dynamicSydekyksModel = (): string => aiRuntime.getModel()
