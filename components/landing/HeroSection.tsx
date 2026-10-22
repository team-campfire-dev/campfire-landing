'use client';

import { useEffect, useRef } from 'react';
import HeroTitle from './hero/HeroTitle';
import { LetterPhysics } from './hero/LetterPhysics';
import { PointerTracker } from './hero/PointerTracker';
import { CampfireController } from './hero/campfire/CampfireController';
import { DEFAULT_FIRE_THEME, fireThemes, type FireThemeId } from './hero/campfire/themes';

interface HeroSectionProps {
  themeId?: FireThemeId;
}

export default function HeroSection({ themeId = DEFAULT_FIRE_THEME }: HeroSectionProps) {
  const theme = fireThemes[themeId];
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const campfireRef = useRef<CampfireController | null>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const canvas = canvasRef.current;
    const title = titleRef.current;
    const layer = layerRef.current;
    if (!section || !canvas || !title || !layer) return;

    const pointer = new PointerTracker(section);
    const campfire = new CampfireController({ canvas, surface: section, pointer });
    const letters = new LetterPhysics({ title, layer, surface: section, pointer, fire: campfire });
    campfireRef.current = campfire;

    return () => {
      letters.destroy();
      campfire.destroy();
      pointer.destroy();
      campfireRef.current = null;
    };
  }, []);

  // Runs after the setup effect above, so the controller exists by now.
  useEffect(() => {
    campfireRef.current?.setTheme(theme);
  }, [theme]);

  const palette = {
    '--title-from': theme.palette.titleFrom,
    '--title-to': theme.palette.titleTo,
    '--title-glow': theme.palette.titleGlow,
    '--hero-ambient': theme.palette.ambient,
  } as React.CSSProperties;

  return (
    <section ref={sectionRef} className="hero-section" data-fire-theme={theme.id} style={palette}>
      <canvas ref={canvasRef} className="campfire-canvas" aria-hidden="true" />
      <div className="hero-content">
        <HeroTitle ref={titleRef} text="Team Campfire" />
        <p className="hero-subtitle">여러 분야의 작은 열정들이 만나는 공간</p>
      </div>
      <div ref={layerRef} className="hero-physics-layer" aria-hidden="true" />
    </section>
  );
}
