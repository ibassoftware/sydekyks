export const shieldFailureStage = (error: unknown): 'Assess' | 'Brief' => {
  const text =
    (error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error)) ?? ''
  return /shield brief failed|alerts\./i.test(text) ? 'Brief' : 'Assess'
}
