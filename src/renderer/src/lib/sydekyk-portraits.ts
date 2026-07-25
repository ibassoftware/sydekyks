import ledgerPortrait from '../assets/portraits/ledger.jpg'
import mirrorPortrait from '../assets/portraits/mirror.jpg'
import nudgePortrait from '../assets/portraits/nudge.jpg'
import shieldPortrait from '../assets/portraits/shield.jpg'
import sydPortrait from '../assets/portraits/syd.png'

export const sydekykPortraits = {
  ledger: ledgerPortrait,
  mirror: mirrorPortrait,
  nudge: nudgePortrait,
  shield: shieldPortrait,
  syd: sydPortrait
} as const

export type SydekykPortraitId = keyof typeof sydekykPortraits

export const portraitFor = (id: string): string | undefined =>
  sydekykPortraits[id.toLocaleLowerCase() as SydekykPortraitId]
