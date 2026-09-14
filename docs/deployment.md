# 배포 & 스크립트

## 스크립트

```bash
npm run dev       # SSH 터널 + 개발 서버 (localhost:3000)
npm run build     # 프로덕션 빌드
npm run lint      # ESLint 실행 (eslint .)
npm start         # 프로덕션 서버 (로컬 테스트용, Docker에서는 node server.js)
npm run db:tunnel # SSH 터널만 실행 (DB 작업용)
```

> `postinstall`에서 `prisma generate`가 자동 실행됩니다.

## 환경변수

`.env.example`을 복사해 `.env.local`을 만들어 사용합니다. (`.env*`, `key/`, `*.pem`은 gitignore 대상)

| 변수 | 용도 |
|------|------|
| `SSH_USER`, `SSH_HOST`, `SSH_PORT`, `SSH_KEY_PATH` | 개발 환경 DB 접근용 SSH 터널 |
| `DB_HOST`, `DB_PORT`, `DB_LOCAL_PORT` | 로컬 포트 포워딩 설정 |
| `DATABASE_URL` | Prisma 연결 문자열 (MySQL) |

## 브랜치 전략

- 개발은 `main` 브랜치에서 진행합니다.
- `prod` 브랜치에 push되면 자동 배포가 트리거됩니다.
- 배포는 `main → prod` PR을 머지하는 방식으로 진행합니다. (PR 대상이 `prod`이면 CI만 실행)

## CI/CD 파이프라인

`.github/workflows/deploy.yml`

```
git push → prod 브랜치
  ↓
GitHub Actions (CI)
  ├── npm ci
  ├── npm run lint
  └── npm run build
  ↓ (push만 배포, PR은 CI까지만)
SSH → Oracle VM
  ├── git pull origin prod
  ├── .env.local 생성 (ENV_FILE 시크릿)
  └── docker compose up -d --build
```

### GitHub Repository 시크릿

| 시크릿 | 내용 |
|--------|------|
| `HOST` | Oracle VM IP |
| `USERNAME` | SSH 유저명 |
| `KEY` | SSH 프라이빗 키 |
| `ENV_FILE` | `.env.local` 내용 (선택사항) |
