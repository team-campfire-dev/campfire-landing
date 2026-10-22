import { Fragment } from 'react';

interface HeroTitleProps {
  text: string;
  ref?: React.Ref<HTMLHeadingElement>;
}

/** Title split into per-letter spans so LetterPhysics can knock each one loose. */
export default function HeroTitle({ text, ref }: HeroTitleProps) {
  const words = text.split(' ');
  const total = words.join('').length;
  const starts = words.map((_, i) => words.slice(0, i).join('').length);

  return (
    <h1 ref={ref} className="hero-title" aria-label={text}>
      {words.map((word, w) => (
        <Fragment key={w}>
          {w > 0 && ' '}
          <span className="hero-word" aria-hidden="true">
            {Array.from(word).map((char, c) => {
              const i = starts[w] + c;
              return (
                <span
                  key={c}
                  data-letter
                  className="hero-letter"
                  style={{ '--t0': i / total, '--t1': (i + 1) / total } as React.CSSProperties}
                >
                  {char}
                </span>
              );
            })}
          </span>
        </Fragment>
      ))}
    </h1>
  );
}
