const odooTechnicalName = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/
const odooFieldName = /^[a-z][a-z0-9_]*$/

export const isValidOdooModelName = (model: string): boolean =>
  odooTechnicalName.test(model.trim().toLocaleLowerCase())

export const isValidOdooFieldName = (field: string): boolean =>
  odooFieldName.test(field.trim().toLocaleLowerCase())
