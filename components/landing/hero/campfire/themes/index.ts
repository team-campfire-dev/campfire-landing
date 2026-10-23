import type { FireTheme } from '../types';
import { classicTheme } from './classic';
import { doomTheme } from './doom';
import { minecraftTheme, soulCampfireTheme } from './minecraft';

// Register new themes here — HeroSection picks them by id, the picker lists them in this order.
export const fireThemes = {
  classic: classicTheme,
  doom: doomTheme,
  minecraft: minecraftTheme,
  soul: soulCampfireTheme,
} satisfies Record<string, FireTheme>;

export type FireThemeId = keyof typeof fireThemes;

export const DEFAULT_FIRE_THEME: FireThemeId = 'classic';

export function isFireThemeId(value: unknown): value is FireThemeId {
  return typeof value === 'string' && value in fireThemes;
}
