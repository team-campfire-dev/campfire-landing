import type { FireTheme } from '../types';
import { asciiTheme } from './ascii';
import { classicTheme } from './classic';
import { doomTheme } from './doom';
import { fluidTheme } from './fluid';
import { forgeTheme } from './forge';
import { marshmallowTheme } from './marshmallow';
import { minecraftTheme, soulCampfireTheme } from './minecraft';
import { oneshotTheme } from './oneshot';
import { outerWildsTheme } from './outerWilds';
import { scienceTheme } from './science';
import { sweetPotatoTheme } from './sweetPotato';
import { vectorTheme } from './vector';

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
  oneshot: oneshotTheme,
  fluid: fluidTheme,
  science: scienceTheme,
  vector: vectorTheme,
} satisfies Record<string, FireTheme>;

export type FireThemeId = keyof typeof fireThemes;

export const DEFAULT_FIRE_THEME: FireThemeId = 'classic';

export function isFireThemeId(value: unknown): value is FireThemeId {
  return typeof value === 'string' && value in fireThemes;
}
