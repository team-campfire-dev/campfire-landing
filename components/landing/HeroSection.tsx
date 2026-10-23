'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import HeroTitle from './hero/HeroTitle';
import { LetterPhysics } from './hero/LetterPhysics';
import { PointerTracker } from './hero/PointerTracker';
import { bindSwipe } from './hero/swipe';
import { useFireTheme } from './hero/useFireTheme';
import { CampfireController } from './hero/campfire/CampfireController';
import { DEFAULT_FIRE_THEME, fireThemes, type FireThemeId } from './hero/campfire/themes';

interface HeroSectionProps {
  /** Theme shown until the visitor picks another one. */
  themeId?: FireThemeId;
}

export default function HeroSection({ themeId: defaultThemeId = DEFAULT_FIRE_THEME }: HeroSectionProps) {
  const { themeId, themeIds, setThemeId, stepTheme } = useFireTheme(defaultThemeId);
  const theme = fireThemes[themeId];
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const campfireRef = useRef<CampfireController | null>(null);
  const lettersRef = useRef<LetterPhysics | null>(null);
  /** Bumped on every switch so the theme name flashes up; 0 means no switch yet. */
  const [switchCount, setSwitchCount] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    const canvas = canvasRef.current;
    const title = titleRef.current;
    const layer = layerRef.current;
    if (!section || !canvas || !title || !layer) return;

    const pointer = new PointerTracker(section);
    const campfire = new CampfireController({ canvas, surface: section, pointer });
    const letters = new LetterPhysics({
      title,
      layer,
      surface: section,
      pointer,
      fire: campfire,
      behavior: fireThemes[DEFAULT_FIRE_THEME].letters,
    });
    campfireRef.current = campfire;
    lettersRef.current = letters;

    return () => {
      letters.destroy();
      campfire.destroy();
      pointer.destroy();
      campfireRef.current = null;
      lettersRef.current = null;
    };
  }, []);

  // Runs after the setup effect above, so the controller exists by now.
  useEffect(() => {
    campfireRef.current?.setTheme(theme);
    lettersRef.current?.setBehavior(theme.letters);
  }, [theme]);

  /** Slides the scene in from the side the new theme comes from. */
  const slideIn = useCallback((direction: number) => {
    setSwitchCount((n) => n + 1);
    const offset = direction > 0 ? 1 : -1;
    const options = { duration: 450, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
    canvasRef.current?.animate(
      [{ transform: `translateX(${offset * 12}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
      options,
    );
    contentRef.current?.animate(
      [{ transform: `translateX(${offset * 40}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
      options,
    );
  }, []);

  const changeTheme = useCallback(
    (direction: number) => {
      stepTheme(direction);
      slideIn(direction);
    },
    [stepTheme, slideIn],
  );

  const pickTheme = (id: FireThemeId) => {
    if (id === themeId) return;
    const direction = themeIds.indexOf(id) > themeIds.indexOf(themeId) ? 1 : -1;
    setThemeId(id);
    slideIn(direction);
  };

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    // While dragging, the scene follows the finger a little.
    const drag = (offset: number) => {
      for (const el of [canvasRef.current, contentRef.current]) {
        if (!el) continue;
        el.style.transition = offset ? 'none' : 'transform 0.3s ease, opacity 0.3s ease';
        el.style.transform = offset ? `translateX(${offset * 0.3}px)` : '';
        el.style.opacity = offset ? String(1 - Math.min(Math.abs(offset) / 600, 0.5)) : '';
      }
    };
    return bindSwipe(section, { onSwipe: changeTheme, onDrag: drag });
  }, [changeTheme]);

  const palette = {
    '--title-from': theme.palette.titleFrom,
    '--title-to': theme.palette.titleTo,
    '--title-glow': theme.palette.titleGlow,
    '--hero-ambient': theme.palette.ambient,
  } as React.CSSProperties;

  return (
    <section ref={sectionRef} className="hero-section" data-fire-theme={theme.id} style={palette}>
      <canvas ref={canvasRef} className="campfire-canvas" aria-hidden="true" />
      <div ref={contentRef} className="hero-content">
        <HeroTitle ref={titleRef} text="Team Campfire" />
        <p className="hero-subtitle">여러 분야의 작은 열정들이 만나는 공간</p>
      </div>
      <div ref={layerRef} className="hero-physics-layer" aria-hidden="true" />
      <button type="button" className="fire-theme-arrow is-prev" aria-label="이전 테마" onClick={() => changeTheme(-1)}>
        <svg viewBox="0 0 24 48" aria-hidden="true">
          <path d="M18 4 6 24l12 20" />
        </svg>
      </button>
      <button type="button" className="fire-theme-arrow is-next" aria-label="다음 테마" onClick={() => changeTheme(1)}>
        <svg viewBox="0 0 24 48" aria-hidden="true">
          <path d="M6 4l12 20L6 44" />
        </svg>
      </button>
      <div className="fire-theme-dots" role="group" aria-label="모닥불 테마">
        {themeIds.map((id) => (
          <button
            key={id}
            type="button"
            className="fire-theme-dot"
            aria-label={fireThemes[id].label}
            title={fireThemes[id].label}
            aria-pressed={id === themeId}
            onClick={() => pickTheme(id)}
          />
        ))}
      </div>
      {switchCount > 0 && (
        <div key={switchCount} className="fire-theme-toast" aria-live="polite">
          {theme.label}
        </div>
      )}
    </section>
  );
}
