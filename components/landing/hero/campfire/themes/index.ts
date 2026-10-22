import type { FireTheme } from '../types';
import { classicTheme } from './classic';

// Register new themes here (e.g. doom, minecraft) — HeroSection picks them by id.
export const fireThemes = {
  classic: classicTheme,
} satisfies Record<string, FireTheme>;

export type FireThemeId = keyof typeof fireThemes;

export const DEFAULT_FIRE_THEME: FireThemeId = 'classic';
