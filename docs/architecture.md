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
│   │   ├── HeroSection.tsx     # 캠프파이어 애니메이션 (Client Component)
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

## 향후 확장 계획

이 프로젝트는 DDD(Domain-Driven Design) 기반 아키텍처로 확장될 예정입니다:

1. **DB 데이터 전환** — `data/` 정적 파일 → Prisma ORM 기반 DB 조회로 전환
2. **NextAuth 인증** — GitHub OAuth로 팀원 로그인 (`User` 모델 선반영 완료)
3. **블로그 도메인** — 팀원별 개인 블로그 (Post, Comment, Tag 엔티티)
4. **DDD 레이어** — `src/domain/`, `src/application/`, `src/infrastructure/` 도입
