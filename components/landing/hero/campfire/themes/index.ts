import type { FireTheme } from '../types';
import { asciiTheme } from './ascii';
import { classicTheme } from './classic';
import { doomTheme } from './doom';
import { forgeTheme } from './forge';
import { marshmallowTheme } from './marshmallow';
import { minecraftTheme, soulCampfireTheme } from './minecraft';
import { outerWildsTheme } from './outerWilds';
import { sweetPotatoTheme } from './sweetPotato';

// Register new themes here — HeroSection picks them by id, the picker lists them in this order.
export const fireThemes = {
  classic: classicTheme,
  doom: doomTheme,
  minecraft: minecraftTheme,
  soul: soulCampfireTheme,
  ascii: asciiTheme,
  marshmallow: marshmallowTheme,
  forge: forgeTheme,
  'sweet-potato': sweetPotatoTheme,
  'outer-wilds': outerWildsTheme,
} satisfies Record<string, FireTheme>;

export type FireThemeId = keyof typeof fireThemes;

export const DEFAULT_FIRE_THEME: FireThemeId = 'classic';

export function isFireThemeId(value: unknown): value is FireThemeId {
  return typeof value === 'string' && value in fireThemes;
}
