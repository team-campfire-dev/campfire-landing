# 코딩 컨벤션 & 주의사항

## Next.js 16에서 `next lint` 없음

Next.js 16부터 `next lint` CLI 명령이 제거되었습니다.
lint 스크립트는 `eslint .`을 직접 실행하며, `eslint.config.mjs`에서 `eslint-config-next`를 flat config로 스프레드합니다.

## React 19 Purity Rules

React 19는 컴포넌트 렌더링 중 순수성(purity)을 엄격히 검사합니다.

- `Math.random()` 등 불순 함수를 `useMemo` 안에서 호출하면 `react-hooks/purity` 에러 발생
- `useRef.current`를 렌더링 중 읽으면 `react-hooks/refs` 에러 발생
- 대안: `useState(() => generateRandom())` 형태의 lazy initializer 사용

## Standalone Output 모드

`next.config.ts`에 `output: 'standalone'`이 설정되어 있습니다.

- `npm start` (= `next start`)는 이 모드에서 경고를 표시합니다
- Docker 배포 시에는 `node server.js`로 실행 (Dockerfile에 이미 설정됨)
- 로컬 개발은 `npm run dev`를 사용하세요

## 이미지 최적화

- `next/image`를 사용하며, GitHub 아바타 도메인(`avatars.githubusercontent.com`)이 `next.config.ts`에 등록되어 있습니다
- 새로운 외부 이미지 도메인을 사용할 경우 `next.config.ts`의 `images.remotePatterns`에 추가 필요
- 프로젝트 프리뷰 이미지는 `public/images/`에 두고 `/images/...` 경로로 참조합니다

## Client vs Server Components

- `HeroSection.tsx`만 `'use client'` 지시어 사용 (useState 사용)
- 나머지 컴포넌트는 모두 Server Component
- 새 컴포넌트에서 `useState`, `useEffect` 등 훅 사용 시 `'use client'` 필수
