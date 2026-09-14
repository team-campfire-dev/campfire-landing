# AGENTS.md — AI Agent 필독 문서

**campfire-landing**은 [Team Campfire](https://team-campfire.dev/)의 공식 랜딩 페이지입니다.
Next.js 16 (App Router) · TypeScript · React 19 · Prisma(MySQL) · Docker 배포.

작업 전에 다음 문서를 확인하세요.

## 📚 문서

- [docs/architecture.md](docs/architecture.md) — 기술 스택 · 프로젝트 구조 · 데이터 구조 · 확장 계획
- [docs/deployment.md](docs/deployment.md) — 스크립트 · 환경변수 · CI/CD 파이프라인
- [docs/conventions.md](docs/conventions.md) — Next.js 16 / React 19 주의사항 · Client/Server 구분

## ⚡ 빠른 참조

```bash
npm run dev    # SSH 터널 + 개발 서버 (localhost:3000)
npm run lint   # ESLint (eslint .)
npm run build  # 프로덕션 빌드
```

## 🚨 작업 시 반드시 지킬 것

- **배포**: `main`에서 작업 → `main → prod` PR 머지 시 자동 배포. `prod`에 직접 push 금지.
- **커밋 범위**: 관련 없는 미커밋 변경을 함께 커밋하지 말 것. 의도한 파일만 스테이징.
- **React 19 purity**: 렌더링 중 `Math.random()`·`useRef.current` 읽기 금지 → lazy initializer 사용. ([conventions.md](docs/conventions.md))
- **훅 사용**: `useState`/`useEffect` 등을 쓰는 새 컴포넌트에는 `'use client'` 필수.
- **외부 이미지**: 새 도메인은 `next.config.ts`의 `images.remotePatterns`에 추가.
- **프로젝트 추가**: `data/projects.ts`의 카테고리 배열에 항목 추가 + 프리뷰 이미지를 `public/images/`에 배치.
