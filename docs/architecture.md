# 아키텍처

`campfire-landing`은 [Team Campfire](https://team-campfire.dev/) 개발조직의 공식 랜딩 페이지입니다.
`team-campfire.dev` 핵심 도메인을 사용하며, 추후 팀원 개인 블로그 기능 확장이 예정되어 있습니다.

## 기술 스택

| 항목 | 기술 | 비고 |
|------|------|------|
| **프레임워크** | Next.js 16 (App Router) | `output: 'standalone'` 모드 |
| **언어** | TypeScript | strict 모드 |
| **React** | React 19 | purity rules 적용 (→ [conventions.md](conventions.md)) |
| **DB** | MySQL | Oracle VM, SSH 터널로 개발 환경 접근 |
| **ORM** | Prisma | `prisma/schema.prisma`, singleton client |
| **린트** | ESLint 9 (flat config) | `eslint-config-next` 사용 |
| **배포** | Docker (Node.js standalone) | Oracle VM, GitHub Actions CI/CD (→ [deployment.md](deployment.md)) |

### 도입 준비 중 (부분 구현)
- **인증**: NextAuth.js (GitHub OAuth) — `prisma/schema.prisma`에 `User` 모델 선반영
- **블로그**: DDD 기반 개인 블로그 기능

## 프로젝트 구조

```
campfire-landing/
├── app/                        # Next.js App Router (페이지)
│   ├── layout.tsx              # 루트 레이아웃 + 메타데이터
│   ├── page.tsx                # 랜딩 페이지 (/)
│   ├── globals.css             # 글로벌 CSS 변수 + 리셋
│   └── projects/
│       └── [category]/
│           └── page.tsx        # 프로젝트 상세 (/projects/web, /projects/game)
│
├── components/                 # React 컴포넌트
│   ├── landing/
│   │   ├── HeroSection.tsx     # 히어로 (Client Component) — 모닥불 캔버스 + 인터랙티브 타이틀 조립
│   │   ├── hero/
│   │   │   ├── HeroTitle.tsx   # 글자 단위로 쪼갠 타이틀 마크업
│   │   │   ├── LetterPhysics.ts # 글자 낙하/드래그/던지기/연소 물리 (DOM 직접 제어)
│   │   │   ├── PointerTracker.ts # 히어로 내 포인터 좌표·속도 추적
│   │   │   ├── swipe.ts        # 히어로 좌우 스와이프 → 테마 전환
│   │   │   ├── useFireTheme.ts # 선택한 테마 (localStorage 저장)
│   │   │   └── campfire/
│   │   │       ├── types.ts    # FireTheme / FireRenderer / LetterBehavior 테마 계약
│   │   │       ├── CampfireController.ts # 캔버스 루프·리사이즈·화면 밖 일시정지·탭 라우팅·화면 흔들림
│   │   │       ├── pixelFire.ts # PSX DOOM 불 알고리즘 (픽셀 테마 공용)
│   │   │       ├── noise.ts    # value noise / hash 유틸
│   │   │       └── themes/     # classic · doom · minecraft(+soul) + 레지스트리 (index.ts)
│   │   ├── ProjectCards.tsx    # 카테고리 카드 (Server Component)
│   │   └── MemberGrid.tsx      # 팀원 그리드 (Server Component)
│   ├── projects/
│   │   └── ProjectDetail.tsx   # 프로젝트 목록 (Server Component)
│   └── shared/
│       └── Footer.tsx          # 공통 Footer (Server Component)
│
├── data/                       # 정적 데이터 (추후 DB 전환 대상)
│   ├── projects.ts             # 프로젝트 데이터 + 타입
│   └── members.ts              # 멤버 데이터 + 타입
│
├── lib/                        # 유틸리티 & DB 클라이언트
│   └── prisma.ts               # Prisma 싱글톤 클라이언트
│
├── prisma/                     # Prisma ORM 설정
│   └── schema.prisma           # DB 스키마 (MySQL)
│
├── tools/                      # 개발 도구
│   └── tunnel.js               # SSH 터널 (개발 환경 DB 접근)
│
├── styles/
│   └── landing.css             # 랜딩 페이지 전용 스타일
│
├── public/images/              # 프로젝트 프리뷰 이미지
├── .env.example                # 환경변수 템플릿
├── Dockerfile                  # Multi-stage: deps → build → standalone Node.js
├── docker-compose.yml          # 포트 3000:3000, env_file
├── .github/workflows/deploy.yml # CI/CD (lint → build → SSH deploy)
├── next.config.ts              # standalone output + GitHub 아바타 이미지 도메인
├── tsconfig.json               # path alias @/* → ./*
└── eslint.config.mjs           # ESLint 9 flat config
```

## 데이터 구조

프로젝트/멤버는 현재 `data/`의 정적 파일에서 관리하며, 추후 Prisma 기반 DB 조회로 전환할 예정입니다.

### Project (`data/projects.ts`)

```typescript
interface Project {
  name: string;
  description: string;
  image?: string;       // /images/ 경로의 프리뷰 이미지
  github?: string;
  demo?: string;
  appStore?: string;
  playStore?: string;
  devLog?: string;
  status?: string;      // 'Live' | 'In Development' 등
}

type ProjectCategory = 'web' | 'game';
```

`projects` 객체는 카테고리별 배열(`web`, `game`)로 구성되며, `/projects/[category]` 페이지가 이를 렌더링합니다.
프로젝트를 추가하려면 해당 카테고리 배열에 항목을 추가하고, 프리뷰 이미지를 `public/images/`에 넣습니다.

### Member (`data/members.ts`)

```typescript
interface Member {
  name: string;
  avatar: string;       // GitHub 아바타 URL
  url: string;          // GitHub 프로필 URL
}
```

## 히어로 모닥불 테마

히어로의 모닥불은 Canvas 2D로 그려지며, 테마 단위로 교체할 수 있습니다.
방문자는 히어로를 좌우로 스와이프하거나 상단의 ‹ › 버튼·점으로 테마를 바꾸고, 선택은 localStorage에 저장됩니다.

| 테마 | 불 | 타이틀 글자 | 탭/클릭 |
|------|----|-------------|---------|
| `classic` | 파티클 모닥불 (통나무·돌·불티·연기) | 마우스를 대도 가만히 있고, 눌러서 집으면 빠져나옴 → 끌어서 던지기 | 불 클릭 → 불티 |
| `doom` | PSX DOOM 불 알고리즘 (35Hz), 화면 하단 불벽 | Bungee 폰트, 총으로 쏘면 날아감 | 어디든 총격 → 섬광·화면 흔들림·총소리·총알 자국 |
| `minecraft` / `soul` | 정면 픽셀 아트 모닥불 블록 + 잔디 지면, 앞뒤 두 겹 픽셀 불꽃 혀, 단계형 조명, 네모 연기 | Pixelify Sans 폰트, 떨어진 글자는 아이템처럼 작아져 떠서 회전 | 모닥불 클릭 → 끄기 / 다시 붙이기 |

- **테마 계약** — `components/landing/hero/campfire/types.ts`의 `FireTheme`
  - `palette`: 타이틀 그라디언트·글로우·배경 색 (히어로에 CSS 변수 `--title-from` 등으로 주입)
  - `letters`: 글자가 떨어지는 방식 (`knock: 'touch' | 'shoot'`, `draggable`, `item`)
  - `createRenderer(host)`: `FireRenderer` 생성 — `update`/`draw`(매 프레임), `hotZone`(글자가 타는 영역, 없으면 null), `groundY`(글자가 놓이는 바닥), `tap`(히어로 클릭/탭), `feed`(글자가 불에 들어감). `host.shake()`로 화면을 흔들 수 있음
- **새 테마 추가** — `themes/`에 파일을 만들고 `themes/index.ts`의 `fireThemes`에 등록 (등록 순서 = 캐러셀 순서)
- 테마별 CSS(폰트, 커서 등)는 `.hero-section[data-fire-theme='...']` 셀렉터로 작성. 테마 폰트는 `app/layout.tsx`에서 `next/font`로 로드 (`--font-doom`, `--font-pixel`, preload 없음)

## 향후 확장 계획

이 프로젝트는 DDD(Domain-Driven Design) 기반 아키텍처로 확장될 예정입니다:

1. **DB 데이터 전환** — `data/` 정적 파일 → Prisma ORM 기반 DB 조회로 전환
2. **NextAuth 인증** — GitHub OAuth로 팀원 로그인 (`User` 모델 선반영 완료)
3. **블로그 도메인** — 팀원별 개인 블로그 (Post, Comment, Tag 엔티티)
4. **DDD 레이어** — `src/domain/`, `src/application/`, `src/infrastructure/` 도입
